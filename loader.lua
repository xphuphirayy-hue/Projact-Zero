
--[[
    PROJECT ZERO LOADER / AUTO-LOAD SYSTEM
    ==================================
    Loads and initializes the whitelist system automatically
]]

local HttpService = game:GetService("HttpService")
local RunService = game:GetService("RunService")
local CoreGui = game:GetService("CoreGui")
local Players = game:GetService("Players")

-- ==========================================
-- LOADER CONFIG
-- ==========================================
local Loader = {
    Name = "Project Zero",
    Version = "1.0.0",
    IsLoaded = false,
    WhitelistModule = nil,
    InitTime = 0
}

-- ==========================================
-- LOADER FUNCTIONS
-- ==========================================

function Loader:Initialize()
    self.InitTime = tick()
    print("[Project Zero] Initializing v" .. self.Version)
    
    -- Check if whitelist module exists
    local modulePath = "whitelist.lua"
    local success, module = pcall(function()
        return loadfile(modulePath)()
    end)
    
    if not success or not module then
        -- Try alternative paths
        success, module = pcall(function()
            return loadstring(game:HttpGet("https://your-cdn.com/whitelist.lua"))()
        end)
    end
    
    if success and module then
        self.WhitelistModule = module
        print("[Project Zero] Whitelist module loaded")
    else
        warn("[Project Zero] Failed to load whitelist module")
        self:ShowError("Failed to load whitelist module")
        return false
    end
    
    -- Override callbacks
    self:SetupCallbacks()
    
    -- Initialize whitelist
    local verified = self.Whitelist.Whitelist:Initialize()
    
    if verified then
        self.IsLoaded = true
        self:OnSuccess()
    else
        self.IsLoaded = false
    end
    
    return self.IsLoaded
end

function Loader:SetupCallbacks()
    if not self.WhitelistModule then return end
    
    -- Override the OnVerified callback
    local originalOnVerified = self.WhitelistModule.Whitelist.OnVerified
    self.WhitelistModule.Whitelist.OnVerified = function(data)
        if originalOnVerified then
            originalOnVerified(data)
        end
        self:OnVerified(data)
    end
    
    -- Override the OnDenied callback
    local originalOnDenied = self.WhitelistModule.Whitelist.OnDenied
    self.WhitelistModule.Whitelist.OnDenied = function(data)
        if originalOnDenied then
            originalOnDenied(data)
        end
        self:OnDenied(data)
    end
    
    -- Override the OnExpired callback
    local originalOnExpired = self.WhitelistModule.Whitelist.OnExpired
    self.WhitelistModule.Whitelist.OnExpired = function()
        if originalOnExpired then
            originalOnExpired()
        end
        self:OnExpired()
    end
end

function Loader:OnVerified(data)
    print("[Project Zero] User verified: " .. (data.username or "Unknown"))
    
    -- Start background check loop
    self.WhitelistModule.Whitelist:StartBackgroundCheck()
    
    -- Load the main script
    self:LoadMainScript(data)
    
    -- Show success notification
    self:ShowNotification("Welcome, " .. (data.username or "User") .. "!", "success")
end

function Loader:OnDenied(data)
    print("[Project Zero] Access denied")
    
    -- Create denial screen
    self:ShowDenialScreen(data.message or "Invalid key")
    
    -- Log attempt
    self:LogAttempt("DENIED", data)
end

function Loader:OnExpired()
    print("[Project Zero] Session expired")
    
    -- Create expiry notification
    self:ShowNotification("Session expired. Please re-authenticate.", "error")
    
    -- Log
    self:LogAttempt("EXPIRED", {})
end

function Loader:LoadMainScript(userData)
    -- Load your actual script/cheat here
    -- This is where you would load your main functionality
    
    print("[Project Zero] Loading main script...")
    
    -- Example: Load from file
    local mainScript = "main.lua"
    local success, err = pcall(function()
        if isfile and readfile then
            local content = readfile(mainScript)
            if content and content ~= "" then
                loadstring(content)()
            else
                warn("[Project Zero] Main script not found or empty")
            end
        else
            warn("[Project Zero] File functions not available")
        end
    end)
    
    if not success then
        warn("[Project Zero] Failed to load main script: " .. tostring(err))
    end
end

function Loader:ShowNotification(message, type)
    local screenGui = Instance.new("ScreenGui")
    screenGui.Name = "Project Zero_Notification"
    screenGui.Parent = CoreGui
    
    local frame = Instance.new("Frame")
    frame.Size = UDim2.new(0, 400, 0, 60)
    frame.Position = UDim2.new(0.5, -200, 0.9, 0)
    frame.BackgroundColor3 = type == "success" and Color3.fromRGB(0, 150, 0) or Color3.fromRGB(150, 0, 0)
    frame.BorderSizePixel = 0
    frame.Parent = screenGui
    
    local text = Instance.new("TextLabel")
    text.Size = UDim2.new(1, -20, 1, 0)
    text.Position = UDim2.new(0, 10, 0, 0)
    text.BackgroundTransparency = 1
    text.Text = message
    text.TextColor3 = Color3.new(1, 1, 1)
    text.TextScaled = true
    text.Font = Enum.Font.GothamBold
    text.Parent = frame
    
    -- Fade in
    frame.BackgroundTransparency = 1
    for i = 0, 1, 0.1 do
        frame.BackgroundTransparency = 1 - i
        task.wait(0.05)
    end
    
    -- Fade out after 3 seconds
    task.wait(3)
    for i = 1, 0, -0.1 do
        frame.BackgroundTransparency = 1 - i
        frame.TextTransparency = 1 - i
        task.wait(0.05)
    end
    
    screenGui:Destroy()
end

function Loader:ShowDenialScreen(message)
    local screenGui = Instance.new("ScreenGui")
    screenGui.Name = "Project Zero_Denied"
    screenGui.Parent = CoreGui
    
    local frame = Instance.new("Frame")
    frame.Size = UDim2.new(0, 400, 0, 250)
    frame.Position = UDim2.new(0.5, -200, 0.5, -125)
    frame.BackgroundColor3 = Color3.fromRGB(40, 0, 0)
    frame.BorderSizePixel = 2
    frame.BorderColor3 = Color3.fromRGB(255, 0, 0)
    frame.Parent = screenGui
    
    local title = Instance.new("TextLabel")
    title.Size = UDim2.new(1, 0, 0, 50)
    title.BackgroundTransparency = 1
    title.Text = "ACCESS DENIED"
    title.TextColor3 = Color3.new(1, 0.3, 0.3)
    title.TextScaled = true
    title.Font = Enum.Font.GothamBlack
    title.Parent = frame
    
    local msg = Instance.new("TextLabel")
    msg.Size = UDim2.new(0.9, 0, 0, 100)
    msg.Position = UDim2.new(0.05, 0, 0.25, 0)
    msg.BackgroundTransparency = 1
    msg.Text = message
    msg.TextColor3 = Color3.new(1, 1, 1)
    msg.TextWrapped = true
    msg.TextScaled = true
    msg.Font = Enum.Font.Gotham
    msg.Parent = frame
    
    local closeBtn = Instance.new("TextButton")
    closeBtn.Size = UDim2.new(0.5, 0, 0, 40)
    closeBtn.Position = UDim2.new(0.25, 0, 0.75, 0)
    closeBtn.Text = "EXIT"
    closeBtn.BackgroundColor3 = Color3.fromRGB(150, 0, 0)
    closeBtn.TextColor3 = Color3.new(1, 1, 1)
    closeBtn.Font = Enum.Font.GothamBold
    closeBtn.TextScaled = true
    closeBtn.Parent = frame
    
    closeBtn.MouseButton1Click:Connect(function()
        screenGui:Destroy()
        game:Shutdown()
    end)
end

function Loader:ShowError(message)
    warn("[Project Zero] Error: " .. message)
    -- Show error notification
end

function Loader:LogAttempt(status, data)
    -- Log verification attempt to server or local file
    local logData = {
        timestamp = os.time(),
        status = status,
        user = data.username or "Unknown",
        key = data.key or "N/A",
        executor = self:GetExecutorName(),
        hwid = data.hwid or "N/A"
    }
    
    -- Try to send to server
    if self.WhitelistModule and self.WhitelistModule.Network then
        pcall(function()
            self.WhitelistModule.Network:Request("/log", logData)
        end)
    end
    
    -- Also save locally
    if isfile and writefile then
        local logContent = "[Project Zero Log] " .. os.date("%Y-%m-%d %H:%M:%S") .. 
                          " - Status: " .. status .. 
                          " - User: " .. (logData.user or "Unknown") .. "\n"
        appendfile("Project Zero_Logs.txt", logContent)
    end
end

function Loader:GetExecutorName()
    if syn then return "Synapse X" end
    if Krnl then return "Krnl" end
    if fluxus then return "Fluxus" end
    if electron then return "Electron" end
    if delta then return "Delta" end
    if xeno then return "Xeno" end
    if velocity then return "Velocity" end
    return "Unknown"
end

function Loader:GetStatus()
    return {
        IsLoaded = self.IsLoaded,
        IsVerified = self.WhitelistModule and self.WhitelistModule.Whitelist.IsVerified or false,
        User = self.WhitelistModule and self.WhitelistModule.Whitelist.UserData or nil,
        Version = self.Version,
        Executor = self:GetExecutorName(),
        InitTime = self.InitTime
    }
end

-- ==========================================
-- AUTO-START
-- ==========================================

-- Wait for game to load properly
if game:IsLoaded() then
    Loader:Initialize()
else
    game.Loaded:Connect(function()
        task.wait(1) -- Small delay to ensure everything is ready
        Loader:Initialize()
    end)
end

-- ==========================================
-- EXPORT
-- ==========================================
_G.Project Zero = Loader
_G.Project ZeroLoader = Loader

return Loader
