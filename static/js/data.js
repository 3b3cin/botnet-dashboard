// Global variables
let clients = [];
let commandCount = 0;
let taskCount = 0;
let selectedPriority = 2;
let activityLog = [];
let clientOutputLog = [];
let isDarkMode = true;

// Initialize Socket.IO
const socket = io();

// Theme management
function initTheme() {
    const saved = localStorage.getItem('theme');
    if (saved) {
        isDarkMode = saved === 'dark';
    } else {
        isDarkMode = window.matchMedia('(prefers-color-scheme: dark)').matches;
    }
    updateTheme();
}

function updateTheme() {
    if (isDarkMode) {
        document.documentElement.classList.add('dark');
        document.getElementById('themeIcon').textContent = '☀️';
    } else {
        document.documentElement.classList.remove('dark');
        document.getElementById('themeIcon').textContent = '🌙';
    }
    localStorage.setItem('theme', isDarkMode ? 'dark' : 'light');
}

function toggleTheme() {
    isDarkMode = !isDarkMode;
    updateTheme();
}

// Socket events
socket.on('connect', function() {
    updateConnectionStatus(true);
    refreshData();
    addActivity('System', 'Connected to server', 'success');
});

socket.on('disconnect', function() {
    updateConnectionStatus(false);
    addActivity('System', 'Disconnected from server', 'error');
});

socket.on('setup_client', function(data) {
    refreshData();
    addActivity('System', `New client connected: ${data.client_id.substring(0, 8)}...`, 'info');
});

socket.on('client_disconnected', function(data) {
    refreshData();
    addActivity('System', data.response, 'warning');
});

socket.on('received', function(data) {
    console.log('Command response:', data);
    if (data.status === 'done') {
        addActivity('Task Complete', data.message, 'success');
        if (data.output) {
            addOutput('Task Output', data.output, data.client || 'Unknown', 'output');
        }
        if (data.error) {
            addOutput('Task Error', data.error, data.client || 'Unknown', 'error');
        }
    } else if (data.output) {
        addOutput('Command Response', data.output, data.client || 'Unknown', 'output');
    } else if (data.error) {
        addOutput('Command Error', data.error, data.client || 'Unknown', 'error');
    }
});

socket.on('executed_cmd', function(data) {
    console.log('Task execution result:', data);
    taskCount++;
    updateStats();
    addActivity('Task Executed', `${data.name} completed on ${data.client_id.substring(0, 8)}...`, 'success');
    if (data.output) {
        addOutput(data.name, data.output, data.client_id, 'output');
    }
});

// Handle the cmd_output event emitted by your backend
socket.on('cmd_output', function(data) {
    console.log('Command output received:', data);
    if (data.output) {
        addOutput(data.name || 'Command Output', data.output, data.client || 'Unknown', 'output');
    }
});

// Priority buttons
document.querySelectorAll('.priority-btn').forEach(btn => {
    btn.addEventListener('click', function() {
        document.querySelectorAll('.priority-btn').forEach(b => {
            b.classList.remove('active', 'border-2', 'border-blue-500', 'bg-blue-50', 'dark:bg-blue-900/20', 'text-blue-700', 'dark:text-blue-300');
            b.classList.add('border', 'border-gray-300', 'dark:border-slate-600');
        });
        this.classList.remove('border', 'border-gray-300', 'dark:border-slate-600');
        this.classList.add('active', 'border-2', 'border-blue-500', 'bg-blue-50', 'dark:bg-blue-900/20', 'text-blue-700', 'dark:text-blue-300');
        selectedPriority = parseInt(this.dataset.priority);
    });
});

// Keyboard shortcuts
document.getElementById('commandInput').addEventListener('keypress', function(e) {
    if (e.key === 'Enter') {
        if (e.shiftKey) {
            createTask();
        } else {
            sendToAllClients();
        }
    }
});

document.getElementById('themeToggle').addEventListener('click', toggleTheme);

// Functions
function updateConnectionStatus(connected) {
    const dot = document.getElementById('connectionDot');
    const text = document.getElementById('connectionText');
    
    if (connected) {
        dot.className = 'w-3 h-3 bg-green-500 rounded-full animate-pulse';
        text.textContent = 'Connected';
    } else {
        dot.className = 'w-3 h-3 bg-red-500 rounded-full animate-pulse';
        text.textContent = 'Disconnected';
    }
}

async function refreshData() {
    try {
        const response = await fetch('/clients');
        clients = await response.json();
        updateClientDisplay();
        updateStats();
    } catch (error) {
        addActivity('Error', 'Failed to fetch client data', 'error');
    }
}

function updateClientDisplay() {
    const container = document.getElementById('clientsContainer');
    
    if (clients.length === 0) {
        container.innerHTML = `
            <div class="text-center py-12 text-gray-500 dark:text-gray-400">
                <svg class="mx-auto h-12 w-12 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"></path>
                </svg>
                <p class="text-lg font-medium">No clients connected</p>
                <p class="text-sm">Start your client applications to see them here</p>
            </div>
        `;
        document.getElementById('createTaskBtn').disabled = true;
        document.getElementById('sendAllBtn').disabled = true;
        return;
    }

    document.getElementById('createTaskBtn').disabled = false;
    document.getElementById('sendAllBtn').disabled = false;

    container.innerHTML = clients.map((client, index) => {
        const cpuColor = client.cpu < 30 ? 'text-green-600 dark:text-green-400' : 
                       client.cpu < 70 ? 'text-yellow-600 dark:text-yellow-400' : 
                       'text-red-600 dark:text-red-400';
        
        const progressColor = client.cpu < 30 ? 'bg-green-500' : 
                            client.cpu < 70 ? 'bg-yellow-500' : 'bg-red-500';
        
        const statusColor = client.status.toLowerCase() === 'pending' ? 
                          'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/20 dark:text-yellow-300' : 
                          'bg-red-100 text-red-800 dark:bg-red-900/20 dark:text-red-300';
        
        return `
            <div class="bg-white dark:bg-slate-800 rounded-lg p-4 border border-gray-200 dark:border-slate-700 transition-all duration-300 hover:shadow-lg animate-fade-in" style="animation-delay: ${index * 0.1}s">
                <div class="flex items-center justify-between mb-3">
                    <div>
                        <h3 class="font-medium text-gray-900 dark:text-white">${client.name || 'Unknown Client'}</h3>
                        <p class="text-sm text-gray-600 dark:text-gray-400">ID: ${client.id.substring(0, 12)}...</p>
                    </div>
                    <div class="text-right">
                        <div class="${cpuColor} text-lg font-semibold">${client.cpu}%</div>
                        <span class="inline-flex px-2 py-1 text-xs font-medium rounded-full ${statusColor}">${client.status}</span>
                    </div>
                </div>
                <div class="mb-2">
                    <div class="flex justify-between text-sm text-gray-600 dark:text-gray-400 mb-1">
                        <span>CPU Usage</span>
                        <span>${client.cpu}%</span>
                    </div>
                    <div class="w-full bg-gray-200 dark:bg-slate-700 rounded-full h-2">
                        <div class="${progressColor} h-2 rounded-full transition-all duration-500" style="width: ${client.cpu}%"></div>
                    </div>
                </div>
                <div class="flex justify-between text-xs text-gray-500 dark:text-gray-400">
                    <span>Connected: ${client.timeConnected}</span>
                    <span>Updated: ${new Date().toLocaleTimeString()}</span>
                </div>
            </div>
        `;
    }).join('');
}

function updateStats() {
    document.getElementById('totalClients').textContent = clients.length;
    
    const avgCpu = clients.length > 0 ? 
        Math.round(clients.reduce((sum, c) => sum + c.cpu, 0) / clients.length) : 0;
    document.getElementById('avgCpu').textContent = avgCpu + '%';
    
    document.getElementById('commandCount').textContent = commandCount;
    document.getElementById('taskCount').textContent = taskCount;
}

async function sendToAllClients() {
    const command = document.getElementById('commandInput').value.trim();
    if (!command) {
        addActivity('Error', 'Please enter a command', 'error');
        return;
    }

    if (!clients.length) {
        addActivity('Error', 'No clients connected', 'error');
        return;
    }

    try {
        const response = await fetch('/command', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ cmd: command })
        });

        const result = await response.json();
        if (result.status === 'sent') {
            commandCount++;
            updateStats();
            addActivity('Command Sent', `"${command}" sent to ${clients.length} clients`, 'info');
            document.getElementById('commandInput').value = '';
        } else {
            throw new Error('Failed to send command');
        }
    } catch (error) {
        addActivity('Error', 'Failed to send command to clients', 'error');
    }
}

async function createTask() {
    const taskName = document.getElementById('taskName').value.trim();
    const command = document.getElementById('commandInput').value.trim();
    const scheduleTime = document.getElementById('scheduleTime').value;

    if (!command) {
        addActivity('Error', 'Please enter a command', 'error');
        return;
    }

    if (!taskName) {
        addActivity('Error', 'Please enter a task name', 'error');
        return;
    }

    if (!clients.length) {
        addActivity('Error', 'No clients available for task execution', 'error');
        return;
    }

    const taskData = {
        t_name: taskName,
        command_to_run: command,
        status: 'Pending',
        important: selectedPriority,
        exec_time: scheduleTime || new Date().toISOString()
    };

    try {
        const response = await fetch('/task/find', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(taskData)
        });

        const result = await response.json();
        
        if (response.ok) {
            const scheduleText = scheduleTime ? 
                ` (scheduled for ${new Date(scheduleTime).toLocaleString()})` : ' (immediate)';
            
            addActivity('Task Created', 
                `"${taskName}" assigned to optimal client${scheduleText}`, 'success');
            
            // Clear form
            document.getElementById('taskName').value = '';
            document.getElementById('commandInput').value = '';
            document.getElementById('scheduleTime').value = '';
        } else {
            throw new Error(result.message || result.Error || 'Failed to create task');
        }
    } catch (error) {
        addActivity('Error', `Failed to create task: ${error.message}`, 'error');
    }
}

function addOutput(type, content, clientId, category = 'output') {
    const timestamp = new Date().toLocaleTimeString();
    
    clientOutputLog.unshift({
        type: type,
        content: content,
        clientId: clientId,
        timestamp: timestamp,
        category: category
    });

    if (clientOutputLog.length > 100) {
        clientOutputLog = clientOutputLog.slice(0, 100);
    }

    updateOutputDisplay();
    
    // Flash indicator
    const indicator = document.getElementById('outputIndicator');
    indicator.classList.remove('bg-green-500');
    indicator.classList.add('bg-blue-500');
    setTimeout(() => {
        indicator.classList.remove('bg-blue-500');
        indicator.classList.add('bg-green-500');
    }, 1000);
}

function updateOutputDisplay() {
    const container = document.getElementById('clientOutputContainer');
    
    if (clientOutputLog.length === 0) {
        container.innerHTML = `
            <div class="text-center py-12 text-gray-500 dark:text-gray-400">
                <svg class="mx-auto h-12 w-12 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v14a2 2 0 002 2z"></path>
                </svg>
                <p class="text-lg font-medium">No output yet</p>
                <p class="text-sm">Command and task outputs will appear here</p>
            </div>
        `;
        return;
    }

    const getStyles = (category) => {
        switch(category) {
            case 'output':
                return 'bg-gray-50 dark:bg-gray-800 border-gray-200 dark:border-gray-700';
            case 'error':
                return 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800';
            default:
                return 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800';
        }
    };

    const getTypeColor = (category) => {
        switch(category) {
            case 'output':
                return 'text-gray-700 dark:text-gray-300';
            case 'error':
                return 'text-red-700 dark:text-red-300';
            default:
                return 'text-blue-700 dark:text-blue-300';
        }
    };
    console.log(log);
    container.innerHTML = clientOutputLog.map((log, index) => `
        <div class="border rounded-lg p-4 ${getStyles(log.category)} animate-fade-in" style="animation-delay: ${index * 0.05}s">
            <div class="flex justify-between items-start mb-2">
                <div class="flex items-center space-x-2">
                    <span class="font-medium ${getTypeColor(log.category)}">${log.type}</span>
                    <span class="text-xs px-2 py-1 bg-gray-200 dark:bg-gray-700 rounded-full text-gray-600 dark:text-gray-400 font-mono">
                        ${log.clientId.substring(0, 8)}...
                    </span>
                </div>
                <span class="text-sm text-gray-500 dark:text-gray-400">${log.timestamp}</span>
            </div>
            <pre class="text-gray-800 dark:text-gray-200 text-sm leading-relaxed whitespace-pre-wrap break-words bg-white dark:bg-gray-900 p-3 rounded border font-mono">${log.content}</pre>
        </div>
    `).join('');

    container.scrollTop = 0;
}

function addActivity(type, content, category = 'info') {
    const timestamp = new Date().toLocaleTimeString();
    
    activityLog.unshift({
        type: type,
        content: content,
        timestamp: timestamp,
        category: category
    });

    if (activityLog.length > 100) {
        activityLog = activityLog.slice(0, 100);
    }

    updateActivityDisplay();
    
    // Flash indicator
    const indicator = document.getElementById('activityIndicator');
    indicator.classList.remove('bg-blue-500');
    indicator.classList.add('bg-green-500');
    setTimeout(() => {
        indicator.classList.remove('bg-green-500');
        indicator.classList.add('bg-blue-500');
    }, 1000);
}

function updateActivityDisplay() {
    const container = document.getElementById('activityContainer');
    
    if (activityLog.length === 0) {
        container.innerHTML = `
            <div class="text-center py-12 text-gray-500 dark:text-gray-400">
                <svg class="mx-auto h-12 w-12 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path>
                </svg>
                <p class="text-lg font-medium">No activity yet</p>
                <p class="text-sm">System events will appear here</p>
            </div>
        `;
        return;
    }

    const getStyles = (category) => {
        switch(category) {
            case 'success':
                return 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800';
            case 'error':
                return 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800';
            case 'warning':
                return 'bg-yellow-50 dark:bg-yellow-900/20 border-yellow-200 dark:border-yellow-800';
            case 'info':
                return 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800';
            default:
                return 'bg-gray-50 dark:bg-gray-800 border-gray-200 dark:border-gray-700';
        }
    };

    const getTypeColor = (category) => {
        switch(category) {
            case 'success':
                return 'text-green-700 dark:text-green-300';
            case 'error':
                return 'text-red-700 dark:text-red-300';
            case 'warning':
                return 'text-yellow-700 dark:text-yellow-300';
            case 'info':
                return 'text-blue-700 dark:text-blue-300';
            default:
                return 'text-gray-700 dark:text-gray-300';
        }
    };

    container.innerHTML = activityLog.map((log, index) => `
        <div class="border rounded-lg p-4 ${getStyles(log.category)} animate-fade-in" style="animation-delay: ${index * 0.05}s">
            <div class="flex justify-between items-start mb-2">
                <span class="font-medium ${getTypeColor(log.category)}">${log.type}</span>
                <span class="text-sm text-gray-500 dark:text-gray-400">${log.timestamp}</span>
            </div>
            <p class="text-gray-800 dark:text-gray-200 text-sm leading-relaxed break-words">${log.content}</p>
        </div>
    `).join('');

    container.scrollTop = 0;
}

function clearOutput() {
    clientOutputLog = [];
    updateOutputDisplay();
}

function clearActivityLog() {
    activityLog = [];
    updateActivityDisplay();
}

function setDefaultScheduleTime() {
    const now = new Date();
    now.setMinutes(now.getMinutes() + 1);
    const defaultTime = now.toISOString().slice(0, 16);
    document.getElementById('scheduleTime').value = defaultTime;
}

// Initialize
function init() {
    initTheme();
    refreshData();
    setDefaultScheduleTime();
}

// Auto-refresh every 5 seconds
setInterval(refreshData, 5000);

// Initialize when page loads
document.addEventListener('DOMContentLoaded', init);