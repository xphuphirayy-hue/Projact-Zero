
--[[
    PROJECT ZERO : WHITELIST
    ========================
    A Lua whitelist/authentication system.
    Supports: HWID check, Key verification, Expiry, Anti-tebugger, Secure API
]]

local HttpService = game:GetService("HttpService")
local RunService = game:GetService("RunService")
local CoreGui = game:GetService("CoreGui")
local Players = game:GetService("Players")
local TeleportService = game:GetService("TeleportService")
local Stats = game:GetService("Stats")
local LocalPlayer = Players.LocalPlayer

-- ==========================================
-- CONFIGURATION
-- ==========================================
local CONFIG = {
    PROJECT_ZERO = "Project Zero : Whitelist",
    SECRET_KEY = "CHANGE_THIS_TO_YOUR_SECRET_KEY",
    VERSION = "1.0.0",
    MAX_RETRIES = 3,
    TIMEOUT = 15,
    ALLOWED_EXECUTORS = {"Synapse X", "Delta", "Krnl", "Fluxus", "Electron", "Velocity", "Xeno"},
    CHECK_INTERVAL = 300, -- seconds
    GETKEY_ENABLED = true,
    GETKEY_URL = "https://your-domain.com/getkey",
}

-- ==========================================
-- ENCRYPTION / HASH UTILITIES
-- ==========================================
local Encryption = {}

function Encryption:GenerateHash(data, secret)
    local hash = 0
    for i = 1, #data do
        hash = ((hash << 5) - hash) + string.byte(data, i)
        hash = hash & 0xFFFFFFFF
    end
    if secret then
        for i = 1, #secret do
            hash = ((hash << 5) - hash) + string.byte(secret, i)
            hash = hash & 0xFFFFFFFF
        end
    end
    return string.format("%08x", hash)
end

function Encryption:Encrypt(data, key)
    local result = {}
    for i = 1, #data do
        local char = string.byte(data, i)
        local keyChar = string.byte(key, ((i - 1) % #key) + 1)
        result[i] = string.char((char + keyChar) % 256)
    end
    return table.concat(result)
end

function Encryption:Decrypt(data, key)
    local result = {}
    for i = 1, #data do
        local char = string.byte(data, i)
        local keyChar = string.byte(key, ((i - 1) % #key) + 1)
        result[i] = string.char((char - keyChar) % 256)
    end
    return table.concat(result)
end

-- ==========================================
-- HWID GENERATOR
-- ==========================================
local HWID = {}

function HWID:GetPlatform()
    if getfenv then
        return "PC"
    elseif syn and syn.protect_gui then
        return "PC"
    else
        return "Unknown"
    end
end

function HWID:GetHardwareId()
    local hwid_data = ""
    
    -- User ID
    if LocalPlayer then
        hwid_data = hwid_data .. tostring(LocalPlayer.UserId) .. "_"
    end
    
    -- Username
    if LocalPlayer then
        hwid_data = hwid_data .. tostring(LocalPlayer.Name) .. "_"
    end
    
    -- Account Age
    if LocalPlayer then
        hwid_data = hwid_data .. tostring(LocalPlayer.AccountAge) .. "_"
    end
    
    -- Game ID
    if game and game.GameId then
        hwid_data = hwid_data .. tostring(game.GameId) .. "_"
    end
    
    -- Job ID (unique per session)
    if game and game.JobId then
        hwid_data = hwid_data .. tostring(game.JobId) .. "_"
    end
    
    -- Executor identification
    local executor = "Unknown"
    if syn then executor = "Synapse" end
    if Krnl then executor = "Krnl" end
    if fluxus then executor = "Fluxus" end
    if electron then executor = "Electron" end
    if delta then executor = "Delta" end
    if xeno then executor = "Xeno" end
    if velocity then executor = "Velocity" end
    
    hwid_data = hwid_data .. executor .. "_"
    
    -- Platform
    hwid_data = hwid_data .. HWID:GetPlatform()
    
    return Encryption:GenerateHash(hwid_data, CONFIG.SECRET_KEY)
end

function HWID:GetExecutors()
    return CONFIG.ALLOWED_EXECUTORS
end

-- ==========================================
-- NETWORK / API HANDLER
-- ==========================================
local Network = {}

function Network:Request(endpoint, data, method)
    method = method or "POST"
    local url = CONFIG.API_URL .. endpoint
    
    local success, result = pcall(function()
        if syn and syn.request then
            local req = syn.request({
                Url = url,
                Method = method,
                Headers = {
                    ["Content-Type"] = "application/json",
                    ["User-Agent"] = "Project Zero-Whitelist/" .. CONFIG.VERSION
                },
                Body = HttpService:JSONEncode(data),
            })
            return req
        elseif http and http_request then
            local req = http_request({
                Url = url,
                Method = method,
                Headers = {
                    ["Content-Type"] = "application/json",
                    ["User-Agent"] = "Project Zero-Whitelist/" .. CONFIG.VERSION
                },
                Body = HttpService:JSONEncode(data),
            })
            return req
        else
            return nil, "No HTTP request function available"
        end
    end)
    
    if not success then
        return nil, result
    end
    
    return result
end

function Network:VerifyUser(key, hwid)
    local response, err = Network:Request("/verify", {
        key = key,
        hwid = hwid,
        version = CONFIG.VERSION,
        executor = HWID:GetExecutorName()
    })
    
    if not response then
        return nil, err
    end
    
    local success, data = pcall(function()
        return HttpService:JSONDecode(response.Body)
    end)
    
    if not success then
        return nil, "Invalid response from server"
    end
    
    return data
end

function Network:CheckStatus(key, hwid)
    local response, err = Network:Request("/status", {
        key = key,
        hwid = hwid
    })
    
    if not response then
        return nil, err
    end
    
    local success, data = pcall(function()
        return HttpService:JSONDecode(response.Body)
    end)
    
    if not success then
        return nil, "Invalid response"
    end
    
    return data
end

-- ==========================================
-- GETKEY / WORK.LINK SYSTEM
-- ==========================================
local Getkey = {}

function Getkey:GenerateSessionId()
    return Encryption:GenerateHash(tostring(os.time()) .. tostring(math.random(100000, 999999)))
end

function Getkey:CreateRequest()
    local sessionId = self:GenerateSessionId()
    local hwid = HWID:GetHardwareId()
    local executor = HWID:GetExecutorName()
    
    local response, err = Network:Request("/getkey/request", {
        session_id = sessionId,
        hwid = hwid,
        executor = executor
    })
    
    if not response then
        return nil, err
    end
    
    local success, data = pcall(function()
        return HttpService:JSONDecode(response.Body)
    end)
    
    if not success then
        return nil, "Invalid response"
    end
    
    return data
end

function Getkey:CompleteWork(sessionId, taskProofs)
    local response, err = Network:Request("/getkey/complete", {
        session_id = sessionId,
        task_proofs = taskProofs
    })
    
    if not response then
        return nil, err
    end
    
    local success, data = pcall(function()
        return HttpService:JSONDecode(response.Body)
    end)
    
    if not success then
        return nil, "Invalid response"
    end
    
    return data
end

function Getkey:CheckStatus(sessionId)
    local response, err = Network:Request("/getkey/status/" .. sessionId, {}, "GET")
    
    if not response then
        return nil, err
    end
    
    local success, data = pcall(function()
        return HttpService:JSONDecode(response.Body)
    end)
    
    if not success then
        return nil, "Invalid response"
    end
    
    return data
end

function Getkey:OpenWorkPage(sessionId)
    local url = CONFIG.GETKEY_URL .. "?session=" .. sessionId
    if syn and syn.queue_on_teleport then
        syn.queue_on_teleport('game:GetService("Players").LocalPlayer:Kick("Please rejoin after completing the work")')
    end
    setclipboard(url)
    return url
end

-- ==========================================
-- ANTI-DEBUGGER / ANTI-TAMPER
-- ==========================================
local Security = {}

function Security:IsDebuggerPresent()
    local checks = {
        function() return debug.traceback and debug.traceback() ~= nil end,
        function() return getfenv and getfenv() ~= nil end,
        function() return hookfunction and hookfunction ~= nil end,
        function() return getmetatable and getmetatable(_G) ~= nil end,
        function() return newcclosure and newcclosure ~= nil end,
        function() return clonefunction and clonefunction ~= nil end,
        function() return isexecutorclosure and isexecutorclosure(function() end) end,
        function() return checkcaller and checkcaller() end,
    }
    
    for _, check in ipairs(checks) do
        local result = pcall(check)
        if not result then
            return true
        end
    end
    
    -- Check for common debugger tools
    local debugger_indicators = {
        "OllyDbg", "x64dbg", "IDA", "Ghidra", "Cheat Engine",
        "Process Hacker", "Wireshark", "dnSpy", "ILSpy"
    }
    
    for _, name in ipairs(debugger_indicators) do
        if debugger_indicators then -- placeholder for actual process check
        end
    end
    
    return false
end

function Security:PreventDecompiler()
    -- Basic anti-decompiler measures
    local original = _G
    setmetatable(_G, {
        __newindex = function(t, k, v)
            if k == "script" or k == "source" then
                return
            end
            rawset(t, k, v)
        end
    })
end

function Security:SecureGlobals()
    local protected = {
        "print", "warn", "error", "require", "loadstring",
        "loadfile", "dofile", "pcall", "xpcall"
    }
    
    for _, func in ipairs(protected) do
        if _G[func] then
            _G[func] = function(...)
                local src = debug.traceback()
                local isTrusted = string.find(src, "Project Zero") or string.find(src, "PROJECT ZERO")
                if not isTrusted then
                    -- Potentially log or ignore
                end
                return _G["_" .. func](...)
            end
        end
    end
end

-- ==========================================
-- MAIN WHITELIST MANAGER
-- ==========================================
local Whitelist = {}

Whitelist.CurrentKey = nil
Whitelist.IsVerified = false
Whitelist.UserData = nil
Whitelist.LastCheck = 0

function Whitelist:Initialize()
    -- Check for debugger
    if Security:IsDebuggerPresent() then
        warn("[PROJECT ZERO] Debugger detected. Exiting...")
        game:Shutdown()
        return false
    end
    
    -- Apply security measures
    Security:PreventDecompiler()
    
    -- Generate HWID
    local hwid = HWID:GetHardwareId()
    print("[PROJECT ZERO] HWID Generated: " .. hwid:sub(1, 8) .. "...")
    
    -- Load saved key if exists
    self:LoadKey()
    
    -- If no key, prompt user
    if not self.CurrentKey then
        self:PromptForKey()
        return false
    end
    
    -- Verify the key
    return self:Verify(self.CurrentKey)
end

function Whitelist:LoadKey()
    -- Try to load from a secure storage location
    local keyFile = "Project Zero_Key.dat"
    local success, content = pcall(function()
        if isfile then
            return readfile(keyFile)
        end
        return nil
    end)
    
    if success and content and content ~= "" then
        self.CurrentKey = content
        print("[PROJECT ZERO] Loaded saved key")
    end
end

function Whitelist:SaveKey(key)
    self.CurrentKey = key
    local keyFile = "Project Zero_Key.dat"
    local success, err = pcall(function()
        if isfile and writefile then
            writefile(keyFile, key)
        end
    end)
    
    if not success then
        warn("[PROJECT ZERO] Failed to save key: " .. tostring(err))
    end
end

function Whitelist:PromptForKey()
    -- Create input GUI for key entry
    local screenGui = Instance.new("ScreenGui")
    screenGui.Name = "Project Zero_Input"
    screenGui.Parent = CoreGui
    
    local frame = Instance.new("Frame")
    frame.Size = UDim2.new(0, 320, 0, 220)
    frame.Position = UDim2.new(0.5, -160, 0.5, -110)
    frame.BackgroundColor3 = Color3.fromRGB(30, 30, 30)
    frame.BorderSizePixel = 0
    frame.Parent = screenGui
    
    local title = Instance.new("TextLabel")
    title.Size = UDim2.new(1, 0, 0, 40)
    title.BackgroundTransparency = 1
    title.Text = "PROJECT ZERO WHITELIST"
    title.TextColor3 = Color3.new(1, 1, 1)
    title.TextScaled = true
    title.Font = Enum.Font.GothamBold
    title.Parent = frame
    
    local input = Instance.new("TextBox")
    input.Size = UDim2.new(0.8, 0, 0, 35)
    input.Position = UDim2.new(0.1, 0, 0.2, 0)
    input.PlaceholderText = "Enter your key..."
    input.BackgroundColor3 = Color3.fromRGB(45, 45, 45)
    input.TextColor3 = Color3.new(1, 1, 1)
    input.PlaceholderColor3 = Color3.new(0.7, 0.7, 0.7)
    input.Parent = frame
    
    local submitBtn = Instance.new("TextButton")
    submitBtn.Size = UDim2.new(0.35, 0, 0, 35)
    submitBtn.Position = UDim2.new(0.1, 0, 0.45, 0)
    submitBtn.Text = "VERIFY"
    submitBtn.BackgroundColor3 = Color3.fromRGB(0, 120, 255)
    submitBtn.TextColor3 = Color3.new(1, 1, 1)
    submitBtn.Font = Enum.Font.GothamBold
    submitBtn.TextScaled = true
    submitBtn.Parent = frame
    
    local getkeyBtn = Instance.new("TextButton")
    getkeyBtn.Size = UDim2.new(0.35, 0, 0, 35)
    getkeyBtn.Position = UDim2.new(0.55, 0, 0.45, 0)
    getkeyBtn.Text = "GET KEY"
    getkeyBtn.BackgroundColor3 = Color3.fromRGB(0, 150, 0)
    getkeyBtn.TextColor3 = Color3.new(1, 1, 1)
    getkeyBtn.Font = Enum.Font.GothamBold
    getkeyBtn.TextScaled = true
    getkeyBtn.Parent = frame
    
    local statusText = Instance.new("TextLabel")
    statusText.Size = UDim2.new(1, 0, 0, 20)
    statusText.Position = UDim2.new(0, 0, 0.7, 0)
    statusText.BackgroundTransparency = 1
    statusText.Text = ""
    statusText.TextColor3 = Color3.new(1, 0.5, 0.5)
    statusText.TextScaled = true
    statusText.Font = Enum.Font.Gotham
    statusText.Parent = frame
    
    submitBtn.MouseButton1Click:Connect(function()
        local key = input.Text:gsub("%s", "")
        if key == "" then
            statusText.Text = "Please enter a key"
            return
        end
        
        statusText.Text = "Verifying..."
        
        local success, result = pcall(function()
            return Whitelist:Verify(key)
        end)
        
        if success and result then
            statusText.Text = "Verified! Loading..."
            statusText.TextColor3 = Color3.new(0, 1, 0)
            task.wait(1)
            screenGui:Destroy()
        else
            statusText.Text = "Invalid key or network error"
            statusText.TextColor3 = Color3.new(1, 0.3, 0.3)
        end
    end)
    
    getkeyBtn.MouseButton1Click:Connect(function()
        if not CONFIG.GETKEY_ENABLED then
            statusText.Text = "Getkey is disabled"
            statusText.TextColor3 = Color3.new(1, 0.5, 0.5)
            return
        end
        
        statusText.Text = "Requesting key..."
        statusText.TextColor3 = Color3.new(1, 1, 1)
        
        local sessionId = Getkey:GenerateSessionId()
        local requestData, err = Getkey:CreateRequest()
        
        if not requestData or not requestData.success then
            statusText.Text = "Failed to request key: " .. (err or "Unknown error")
            statusText.TextColor3 = Color3.new(1, 0.3, 0.3)
            return
        end
        
        -- Store session ID for later
        _G.ProjectZeroGetkeySession = sessionId
        
        -- Open work page
        local url = Getkey:OpenWorkPage(sessionId)
        statusText.Text = "Complete tasks at: " .. url
        statusText.TextColor3 = Color3.new(0, 1, 0)
        
        -- Wait for user to complete work
        spawn(function()
            local startTime = tick()
            while tick() - startTime < 600 do -- 10 minute timeout
                task.wait(5)
                local statusData = Getkey:CheckStatus(sessionId)
                if statusData and statusData.success and statusData.key then
                    statusText.Text = "Key received! Please enter it..."
                    statusText.TextColor3 = Color3.new(0, 1, 0)
                    input.Text = statusData.key
                    _G.ProjectZeroGetkeySession = nil
                    return
                end
                if statusData and statusData.status == "approved" and statusData.key then
                    statusText.Text = "Key received! Please enter it..."
                    statusText.TextColor3 = Color3.new(0, 1, 0)
                    input.Text = statusData.key
                    _G.ProjectZeroGetkeySession = nil
                    return
                end
            end
            statusText.Text = "Work timeout. Please try again."
            statusText.TextColor3 = Color3.new(1, 0.3, 0.3)
        end)
    end)
    
    input.FocusLost:Connect(function(enterPressed)
        if enterPressed and input.Text ~= "" then
            submitBtn.MouseButton1Click:Fire()
        end
    end)
end

function Whitelist:Verify(key)
    local hwid = HWID:GetHardwareId()
    local data, err = Network:VerifyUser(key, hwid)
    
    if not data then
        warn("[PROJECT ZERO] Verification failed: " .. tostring(err))
        return false
    end
    
    if data.success then
        self.IsVerified = true
        self.UserData = data
        self.CurrentKey = key
        self.LastCheck = os.time()
        
        -- Save key for later use
        self:SaveKey(key)
        
        print("[PROJECT ZERO] Verification successful!")
        print("[PROJECT ZERO] User: " .. (data.username or "Unknown"))
        print("[PROJECT ZERO] Rank: " .. (data.rank or "User"))
        print("[PROJECT ZERO] Expires: " .. (data.expires or "Never"))
        
        -- Dispatch success event
        self:OnVerified(data)
        
        return true
    else
        warn("[PROJECT ZERO] Verification denied: " .. (data.message or "Unknown reason"))
        self:OnDenied(data)
        return false
    end
end

function Whitelist:Reverify()
    if not self.CurrentKey then
        return false
    end
    
    local hwid = HWID:GetHardwareId()
    local data, err = Network:CheckStatus(self.CurrentKey, hwid)
    
    if not data or not data.success then
        self.IsVerified = false
        self.UserData = nil
        self:OnExpired()
        return false
    end
    
    self.IsVerified = true
    self.UserData = data
    self.LastCheck = os.time()
    return true
end

function Whitelist:GetRank()
    if not self.UserData then
        return "Guest"
    end
    return self.UserData.rank or "User"
end

function Whitelist:GetExpiry()
    if not self.UserData then
        return nil
    end
    return self.UserData.expires
end

function Whitelist:IsExpired()
    if not self.UserData or not self.UserData.expires then
        return false
    end
    
    local expiry = tonumber(self.UserData.expires)
    if not expiry then
        return false
    end
    
    return os.time() > expiry
end

-- ==========================================
-- EVENT CALLBACKS (Override these)
-- ==========================================
function Whitelist:OnVerified(data)
    print("[PROJECT ZERO] Executing OnVerified callback")
    -- Override this in your script to handle successful verification
end

function Whitelist:OnDenied(data)
    print("[PROJECT ZERO] Executing OnDenied callback")
    -- Default behavior: notify and prevent execution
    game:Shutdown()
end

function Whitelist:OnExpired()
    print("[PROJECT ZERO] Executing OnExpired callback")
    -- Default behavior: notify and shutdown
    game:Shutdown()
end

-- ==========================================
-- BACKGROUND CHECK LOOP
-- ==========================================
function Whitelist:StartBackgroundCheck()
    spawn(function()
        while true do
            task.wait(CONFIG.CHECK_INTERVAL)
            
            if self.IsVerified then
                local stillValid = self:Reverify()
                if not stillValid then
                    print("[PROJECT ZERO] Session expired or invalid")
                end
            end
        end
    end)
end

-- ==========================================
-- EXPORT / PUBLIC API
-- ==========================================
return {
    Whitelist = Whitelist,
    Network = Network,
    HWID = HWID,
    Encryption = Encryption,
    Security = Security,
    Getkey = Getkey,
    CONFIG = CONFIG
}
