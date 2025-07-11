from flask import Flask, render_template, jsonify, request, session, Blueprint
from flask_socketio import SocketIO, send, emit, join_room, leave_room
from flask_session import Session
from flask_cors import CORS
import secrets
import time
from datetime import datetime

app = Flask(__name__)
app.debug = True
app.config['SECRET_KEY'] = secrets.token_hex(32)
app.config['SESSION_PERMANENT'] = True
app.config['SESSION_TYPE'] = 'filesystem'
CORS(app)
socketio = SocketIO(app, cors_allowed_origins="*")
Session(app)
# IMPORTANT NOTE* Room IDs are the client ID of the client in that room
connections = {}  # Changed to dict for easier lookup
client_list = []
task_queue = []
session_ids = set()

class Client:
    def __init__(self, id, time, os_name, usage, status='Offline', task = None):
        self.id = id
        self.time_connected = time
        self.os_name = os_name
        self.cpu_usage = usage
        self.status = status
        
        self.task = task
        
    
    def __str__(self):
        return f"Client ID: {self.id}\nName: {self.os_name}\nTime: {self.time_connected}\nCPU: {self.cpu_usage}\nStatus: {self.status}"

class Task:
    def __init__(self, command_to_run, exec_time = datetime.now(), t_name = 'Task', status = 'Pending', important = 2):
        self.t_name = t_name
        self.exec_time = exec_time
        self.status = status
        self.important = important
        self.command_to_run = command_to_run
    
    def find_Client(self) -> Client:
        index_lowest_usage_client = 0
        for index, client in enumerate(client_list):
            if client.cpu_usage < client_list[index_lowest_usage_client]:
                index_lowest_usage_client = index
            else:
                continue
        
        return client_list[index_lowest_usage_client]

    def set_taskName(self, name):
        """Any string is taken"""
        self.t_name = name.strip()
    
    def set_execTime(self, time):
        """Time format as follows 2022-12-27 10:09:20.430322 """
        self.exec_time = time
    
    def set_Importance(self, level):
        """Level goes from 1 (least) to 3 (most) important"""
        self.important = level

    def set_Status(self, status):
        """Status can be Off, Idle, Pending, Running"""
        self.status = status

    def get_tName(self) -> str:
        return self.t_name
    
    def get_execTime(self) -> str:
        return self.exec_time
    
    def get_Importance(self) -> int:
        return self.important
    
    def get_Status(self) -> str:
        return self.status

@app.route("/")
def dashboard() -> object:
    return render_template("./dashboard.html")

@app.route("/clients", methods=['GET'])
def get_clients() -> dict:
    """API endpoint to get all connected clients"""
    client_list = []
    for client in connections.values():
        client_list.append({
            'id': client.id,
            'name': client.os_name,
            'cpu': client.cpu_usage,
            'timeConnected': client.time_connected,
            'status': client.status
        })
    return jsonify(client_list)

@app.route('/command', methods=['POST'])
def send_cmd() -> dict:
    """Sends a command to all connected nodes"""
    print("command sent")
    cmd = request.get_json()
    cmd = cmd['cmd']
    socketio.emit('command', {'execute': cmd})
    response = {
        'status': 'sent',
        'command': cmd
    }
    return jsonify(response)

@socketio.on('received')
def command_run(data) -> None:
    """Prints any returned data"""
    print(data)

@socketio.on('connect')
def handle_connect() -> None:
    """Handles node connections and session handling"""
    session['client_id'] = secrets.token_hex(16)

    if session['client_id'] in session_ids:
        while session['client_id'] in session_ids:
            session['client_id'] = secrets.token_hex(16)
            client_id = session.get('client_id')
            session_ids.add(client_id)
    else:
        client_id = session.get('client_id')
        session_ids.add(client_id)

    emit('client_connect', {'response': 'connected', 'client_id': client_id})

@socketio.on('setup_client')
def setup_client(data) -> None:
    try:
        print("Setup started")
        client_id = session.get('client_id')
        client_time = datetime.now()
        client_time = client_time.strftime("%H:%M:%S")
        os_name = data['os_name']
        cpu = data['cpu']
        new_client = Client(client_id, client_time, os_name, usage=cpu, status=data['status'])
        connections[client_id] = new_client
        client_list.append(new_client)
        emit('setup_client', {'response':'Client successfully setup', 'client_id': client_id})
        print(connections[client_id])
        print(f"Clients Connected: {len(client_list)}")
    except Exception as e:
        emit('setup_client', {'response': f'{e}'})

@socketio.on('update_client')
def update_client(data) -> None:
    """Update client status and CPU usage"""
    try:
        client_id = session.get('client_id')
        cpu = data['cpu']
        status = data['status']
        connections[client_id].cpu = cpu
        connections[client_id].status = status
        print(f"{client_id}: Updated\nCPU Usage: {cpu}\nStatus: {status}")
    except:
        emit('update_client', {'response': 'Error updating client data'})

task_bp = Blueprint("task", __name__)

@task_bp.before_request
def before_task() -> object:
    """Creates a new task object and adds it to the task queue"""
    try:
        data = request.get_json()
        t_name = data['t_name']
        status = data['status']
        importance = data['important']
        command_to_run = data['command_to_run']
        exec_time = data['exec_time']
        new_task = Task(t_name=t_name, status=status, important=importance, command_to_run=command_to_run, exec_time=exec_time)
        task_queue.append(new_task)
    except Exception as e:
        response = {
            "Error": e,
            "message": "Error creating a task"
        }
        return jsonify(response)

@task_bp.route('/find', methods=["POST"])
def send_task(self) -> None:
    """Finds and sends Task data to correct client based on CPU usage"""
    # Create an endpoint for creating tasks then send that data here
    try:
        
        for task in task_queue:

            client_for_task = task.find_client()
            # Parsing data from Task object
            t_name = task.t_name
            status = task.status
            importance = task.important
            exec_time = task.exec_time
            command = task.command_to_run
            # Getting the room_id
            room_id = client_for_task.id

            emit('get_task', {"t_name": t_name, "status": status,
                              "importance": importance, "exec_time": exec_time,
                              "command": command}, room=room_id)
            task_queue.remove(task)
    except Exception as e:
        err_msg = {"Error": e,
                   "message": "Could not find a client or could not send a task"}
        return jsonify(err_msg)
    
@task_bp.after_request
def after_task() -> object:
    response = {
        "message": "Task created"
    }
    return jsonify(response)

app.register_blueprint(task_bp, url_prefix="/task")

@socketio.on('disconnect')
def handle_disconnect() -> None:
    """Handle client disconnection"""
    client_id = session.get('client_id')
    if client_id in connections:
        client_name = connections[client_id].os_name
        del connections[client_id]
        session_ids.discard(client_id)
        client_list.remove(client_id)
            
        # Broadcast disconnection to dashboard
        socketio.emit('client_disconnected', {'response': f"{client_id} disconnected"})
        
        print(f"Client {client_name} ({client_id}) disconnected")
        print(f"Clients Connected: {len(client_list)}")


if __name__ == '__main__':
    socketio.run(app, debug=True, port=5000)