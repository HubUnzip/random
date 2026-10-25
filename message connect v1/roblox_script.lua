--[[
    =======================================================================
    ⚡ ROBLOX WEB RELAY - TWO-WAY CHAT & REMOTE COMMAND BRIDGE ⚡
    =======================================================================
    Connects your Roblox game session to your Vercel Web Dashboard.
    Supports: All Executors (Delta, Synapse, Krnl, Fluxus, Wave, Arceus, etc.)
              AND Roblox Studio / Game Scripts (via HttpService).
    =======================================================================
]]

local CONFIG = {
    -- Replace with your actual Vercel or server URL (NO trailing slash)
    SERVER_URL = "http://localhost:3000",
    
    -- Optional Secret Key (Must match SECRET_KEY env variable on your server if set)
    SECRET_KEY = "",
    
    -- How frequently to poll for new web messages & commands (seconds)
    POLL_INTERVAL = 1.0,
    
    -- If true, messages sent from Web will be spoken by your character in Roblox chat!
    AUTO_CHAT_IN_GAME = true,
    
    -- If true, allows the web dashboard to run remote Luau scripts & commands
    ALLOW_REMOTE_EXECUTION = true,
    
    -- If true, your in-game chat messages are automatically relayed to the Web
    STREAM_GAME_CHAT_TO_WEB = true,
    
    -- If true, periodically sends player health, position, and status to Web
    SEND_HEARTBEAT = true
}

-- Services
local HttpService = game:GetService("HttpService")
local Players = game:GetService("Players")
local RunService = game:GetService("RunService")
local TextChatService = game:GetService("TextChatService")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local StarterGui = game:GetService("StarterGui")

local LocalPlayer = Players.LocalPlayer
local PlayerName = LocalPlayer and LocalPlayer.Name or "ServerScript"
local UserId = LocalPlayer and LocalPlayer.UserId or 0

-- Universal HTTP Request Wrapper
local function httpRequest(url, method, body)
    local method = method or "GET"
    local headers = {
        ["Content-Type"] = "application/json"
    }
    if CONFIG.SECRET_KEY and CONFIG.SECRET_KEY ~= "" then
        headers["x-secret-key"] = CONFIG.SECRET_KEY
    end

    -- 1. Try Executor HTTP function (Synapse, Delta, Fluxus, Krnl, etc.)
    local req = (syn and syn.request) or (http and http.request) or request or http_request or (fluxus and fluxus.request)
    if req then
        local success, result = pcall(function()
            return req({
                Url = url,
                Method = method,
                Headers = headers,
                Body = body
            })
        end)
        if success and result then
            return result.StatusCode or 200, result.Body
        end
    end

    -- 2. Fallback to Roblox HttpService (For Studio or Server Scripts)
    local success, result = pcall(function()
        if method == "POST" then
            return HttpService:PostAsync(url, body or "", Enum.HttpContentType.ApplicationJson, false, headers)
        else
            return HttpService:GetAsync(url, false, headers)
        end
    end)

    if success then
        return 200, result
    else
        return 500, tostring(result)
    end
end

-- Helper: Send notification in Roblox UI
local function showNotification(title, text)
    pcall(function()
        StarterGui:SetCore("SendNotification", {
            Title = title or "Roblox Relay",
            Text = text or "",
            Duration = 4
        })
    end)
end

-- Helper: Speak in Roblox Game Chat
local function speakInRobloxChat(message)
    if not message or message == "" then return end
    
    -- Method 1: New TextChatService (Modern Roblox)
    pcall(function()
        local textChannels = TextChatService:FindFirstChild("TextChannels")
        if textChannels then
            local rbxGeneral = textChannels:FindFirstChild("RBXGeneral")
            if rbxGeneral then
                rbxGeneral:SendAsync(message)
                return
            end
        end
    end)

    -- Method 2: Legacy DefaultChatSystem (ReplicatedStorage)
    pcall(function()
        local chatEvents = ReplicatedStorage:FindFirstChild("DefaultChatSystemChatEvents")
        if chatEvents then
            local sayMsg = chatEvents:FindFirstChild("SayMessageRequest")
            if sayMsg then
                sayMsg:FireServer(message, "All")
                return
            end
        end
    end)

    -- Method 3: Fallback LocalPlayer Chat method
    pcall(function()
        if LocalPlayer and LocalPlayer.Character and LocalPlayer.Character:FindFirstChild("Head") then
            game:GetService("Chat"):Chat(LocalPlayer.Character.Head, message, Enum.ChatColor.Green)
        end
    end)
end

-- API Helper: Send message to Web Bridge
local function sendToWeb(text, msgType, metadata)
    local payload = HttpService:JSONEncode({
        sender = "roblox",
        author = PlayerName,
        text = text,
        type = msgType or "chat",
        metadata = metadata or {
            userId = UserId,
            placeId = game.PlaceId,
            jobId = game.JobId
        }
    })
    httpRequest(CONFIG.SERVER_URL .. "/api/messages", "POST", payload)
end

-- API Helper: Send command response back to Web
local function sendCommandResponse(commandId, status, output)
    local payload = HttpService:JSONEncode({
        commandId = commandId,
        status = status or "success",
        output = tostring(output or ""),
        client = PlayerName
    })
    httpRequest(CONFIG.SERVER_URL .. "/api/commands/respond", "POST", payload)
end

-- API Helper: Send Heartbeat Status
local function sendHeartbeat()
    local char = LocalPlayer and LocalPlayer.Character
    local humanoid = char and char:FindFirstChildOfClass("Humanoid")
    local root = char and char:FindFirstChild("HumanoidRootPart")
    
    local posStr = "0, 0, 0"
    if root then
        local p = root.Position
        posStr = string.format("%.1f, %.1f, %.1f", p.X, p.Y, p.Z)
    end

    local payload = HttpService:JSONEncode({
        username = PlayerName,
        userId = UserId,
        placeId = game.PlaceId,
        jobId = game.JobId or "Studio",
        health = humanoid and humanoid.Health or 100,
        maxHealth = humanoid and humanoid.MaxHealth or 100,
        position = posStr,
        fps = math.floor(1 / math.max(RunService.RenderStepped:Wait(), 0.001)),
        ping = math.floor(game:GetService("Stats").Network.ServerStatsItem["Data Ping"]:GetValueString():match("%d+") or 0)
    })

    httpRequest(CONFIG.SERVER_URL .. "/api/heartbeat", "POST", payload)
end

-- Command Execution Processor
local function processCommand(cmdObj)
    local cmd = string.lower(cmdObj.command or "")
    local args = cmdObj.args or ""
    local cmdId = cmdObj.id

    print(string.format("[Roblox Relay] Processing command: %s (%s)", cmd, args))

    if cmd == "say" or cmd == "chat" then
        speakInRobloxChat(args)
        sendCommandResponse(cmdId, "success", "Spoke in game: " .. args)

    elseif cmd == "kill" or cmd == "reset" then
        local char = LocalPlayer and LocalPlayer.Character
        local hum = char and char:FindFirstChildOfClass("Humanoid")
        if hum then
            hum.Health = 0
            sendCommandResponse(cmdId, "success", "Player killed successfully.")
        else
            sendCommandResponse(cmdId, "error", "Humanoid not found.")
        end

    elseif cmd == "speed" then
        local num = tonumber(args) or 16
        local char = LocalPlayer and LocalPlayer.Character
        local hum = char and char:FindFirstChildOfClass("Humanoid")
        if hum then
            hum.WalkSpeed = num
            sendCommandResponse(cmdId, "success", "WalkSpeed set to " .. tostring(num))
        else
            sendCommandResponse(cmdId, "error", "Humanoid not found.")
        end

    elseif cmd == "jump" then
        local num = tonumber(args) or 50
        local char = LocalPlayer and LocalPlayer.Character
        local hum = char and char:FindFirstChildOfClass("Humanoid")
        if hum then
            hum.JumpPower = num
            hum.UseJumpPower = true
            sendCommandResponse(cmdId, "success", "JumpPower set to " .. tostring(num))
        else
            sendCommandResponse(cmdId, "error", "Humanoid not found.")
        end

    elseif cmd == "tp" or cmd == "teleport" then
        local char = LocalPlayer and LocalPlayer.Character
        local root = char and char:FindFirstChild("HumanoidRootPart")
        if not root then
            sendCommandResponse(cmdId, "error", "HumanoidRootPart not found.")
            return
        end

        -- Check if target is coordinates X,Y,Z
        local x, y, z = args:match("([%-%d%.]+)[%s,]+([%-%d%.]+)[%s,]+([%-%d%.]+)")
        if x and y and z then
            root.CFrame = CFrame.new(tonumber(x), tonumber(y), tonumber(z))
            sendCommandResponse(cmdId, "success", string.format("Teleported to coordinates (%s, %s, %s)", x, y, z))
        else
            -- Check if target is player name
            local targetPlayer = nil
            for _, p in ipairs(Players:GetPlayers()) do
                if string.find(string.lower(p.Name), string.lower(args)) or string.find(string.lower(p.DisplayName), string.lower(args)) then
                    targetPlayer = p
                    break
                end
            end
            if targetPlayer and targetPlayer.Character and targetPlayer.Character:FindFirstChild("HumanoidRootPart") then
                root.CFrame = targetPlayer.Character.HumanoidRootPart.CFrame + Vector3.new(0, 3, 0)
                sendCommandResponse(cmdId, "success", "Teleported to player " .. targetPlayer.Name)
            else
                sendCommandResponse(cmdId, "error", "Player or coordinates not found: " .. args)
            end
        end

    elseif cmd == "players" then
        local list = {}
        for _, p in ipairs(Players:GetPlayers()) do
            table.insert(list, string.format("%s (@%s)", p.DisplayName, p.Name))
        end
        local report = "Active Players (" .. #list .. "): " .. table.concat(list, ", ")
        sendCommandResponse(cmdId, "success", report)

    elseif cmd == "pos" or cmd == "position" then
        local root = LocalPlayer and LocalPlayer.Character and LocalPlayer.Character:FindFirstChild("HumanoidRootPart")
        if root then
            local p = root.Position
            sendCommandResponse(cmdId, "success", string.format("Position: X=%.2f, Y=%.2f, Z=%.2f", p.X, p.Y, p.Z))
        else
            sendCommandResponse(cmdId, "error", "Character position unavailable.")
        end

    elseif cmd == "eval" or cmd == "exec" or cmd == "loadstring" then
        if not CONFIG.ALLOW_REMOTE_EXECUTION then
            sendCommandResponse(cmdId, "error", "Remote Luau Execution is disabled in CONFIG.ALLOW_REMOTE_EXECUTION.")
            return
        end

        local codeChunk, compileError = loadstring(args)
        if not codeChunk then
            sendCommandResponse(cmdId, "error", "Compile Error: " .. tostring(compileError))
            return
        end

        local execSuccess, execResult = pcall(codeChunk)
        if execSuccess then
            sendCommandResponse(cmdId, "success", "Return: " .. tostring(execResult or "nil (Execution successful)"))
        else
            sendCommandResponse(cmdId, "error", "Runtime Error: " .. tostring(execResult))
        end

    else
        -- Unrecognized command, try executing as raw Luau snippet if enabled
        if CONFIG.ALLOW_REMOTE_EXECUTION then
            local chunk, err = loadstring(cmdObj.raw or args)
            if chunk then
                local s, res = pcall(chunk)
                sendCommandResponse(cmdId, s and "success" or "error", tostring(res or "Executed"))
            else
                sendCommandResponse(cmdId, "error", "Unknown command: " .. cmd)
            end
        else
            sendCommandResponse(cmdId, "error", "Unknown command: " .. cmd)
        end
    end
end

-- Stream In-Game Roblox Chat to Web
if CONFIG.STREAM_GAME_CHAT_TO_WEB and LocalPlayer then
    -- Legacy Chatted event
    LocalPlayer.Chatted:Connect(function(msg)
        sendToWeb(msg, "chat", { source = "Roblox In-Game Chat" })
    end)

    -- Modern TextChatService hook
    pcall(function()
        TextChatService.MessageReceived:Connect(function(textChatMessage)
            if textChatMessage.TextSource and textChatMessage.TextSource.UserId == UserId then
                -- Already sent via Chatted or handle here
            end
        end)
    end)
end

-- Main Synchronization Loop
task.spawn(function()
    print("=======================================================")
    print("🚀 [Roblox Relay] Connected to Bridge!")
    print("📡 Server URL: " .. CONFIG.SERVER_URL)
    print("👤 Local Player: " .. PlayerName)
    print("=======================================================")
    
    showNotification("Roblox Web Relay", "Connected to " .. CONFIG.SERVER_URL)

    local lastMsgTimestamp = 0
    local lastHeartbeat = 0

    -- Announce join to Web chat
    sendToWeb(string.format("🎮 Roblox Client [%s] connected from PlaceId %s!", PlayerName, tostring(game.PlaceId)), "system")

    while true do
        task.wait(CONFIG.POLL_INTERVAL)

        -- 1. Send Heartbeat every 5 seconds
        if CONFIG.SEND_HEARTBEAT and (tick() - lastHeartbeat >= 5) then
            pcall(sendHeartbeat)
            lastHeartbeat = tick()
        end

        -- 2. Poll for New Messages from Web
        pcall(function()
            local status, body = httpRequest(CONFIG.SERVER_URL .. "/api/messages?since=" .. tostring(lastMsgTimestamp) .. "&limit=20", "GET")
            if status == 200 and body and body ~= "" then
                local data = HttpService:JSONDecode(body)
                if data and data.messages then
                    for _, msg in ipairs(data.messages) do
                        if msg.timestamp > lastMsgTimestamp then
                            lastMsgTimestamp = msg.timestamp

                            -- If message was sent from Web and auto-chat is enabled:
                            if msg.sender == "web" and msg.type == "chat" then
                                print(string.format("[Web Chat] %s: %s", msg.author, msg.text))
                                if CONFIG.AUTO_CHAT_IN_GAME then
                                    speakInRobloxChat(string.format("[%s]: %s", msg.author, msg.text))
                                else
                                    showNotification(msg.author .. " (Web)", msg.text)
                                end
                            end
                        end
                    end
                end
            end
        end)

        -- 3. Poll for Queued Commands from Web
        if CONFIG.ALLOW_REMOTE_EXECUTION then
            pcall(function()
                local status, body = httpRequest(CONFIG.SERVER_URL .. "/api/commands?client=" .. PlayerName, "GET")
                if status == 200 and body and body ~= "" then
                    local data = HttpService:JSONDecode(body)
                    if data and data.commands then
                        for _, cmd in ipairs(data.commands) do
                            task.spawn(function()
                                processCommand(cmd)
                            end)
                        end
                    end
                end
            end)
        end
    end
end)
