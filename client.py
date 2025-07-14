import socketio
import psutil
import threading
import time
import secrets
from datetime import datetime
import subprocess

# Initialized after connection is established and client is setup
room = ""
output = ""
# Custom commands need to be processed in this class
class Task:
    
    def __init__(self, t_name, exec_time, status, importance, command, client_id):
        self.t_name = t_name
        self.exec_time = exec_time
        self.status = status
        self.importance = importance
        self.command = command
        self.client_id = client_id

    def run_cmd(self) -> bool:
        """Runs a normal command"""
        result = subprocess.run(self.command, shell=True, capture_output=True, text=True)
        if result.stderr:
            return False
        return True
    
    def custom_cmd(self) -> bool:       # This is for later development so leave blank for now
        """Check for a custom command"""
        return


class AutomationClient:
    """For creating the client object and handling connections"""

    def __init__(self, os_name, cpu, status, room_id=None):
        self.os_name = os_name
        self.cpu = cpu
        self.status = status
        self.sio = socketio.Client()
        self.room_id = room_id
        # Register event handlers after creating the client
        self.sio.on('client_connect', self.handle_client_connect)
        self.sio.on('setup_client', self.handle_setup_response)
        self.sio.on('command', self.handle_command)
        self.sio.on('client_disconnected', self.handle_disconnect)
        self.sio.on('message', self.handle_message)
        self.sio.on('update_client', self.update_client)
        self.sio.on('get_task', self.get_task)
        self.sio.on('join_room', self.join_room)
    
    def connect_to_server(self) -> bool:
        try:
            self.sio.connect("http://127.0.0.1:5000")
            print("Connected to server")
        except Exception as e:
            print(f"Failed to connect: {e}")
            return False
        return True
    
    def join_room(self) -> None:
        try: 
            self.sio.emit('join_room', {'room': room})
            print(f"Room joined {room}")
        except Exception as e:
            self.sio.emit('handle_err', {'error': f"{e}"})
    
    def handle_client_connect(self, data) -> None:
        self.room_id = data['client_id']
        print(f"Server response: {data}")
        
    def handle_setup_response(self, data) -> None:
        self.room_id = data['client_id']
        global room
        room = self.room_id
        self.sio.emit('join_room', {'room': room})
        print(f"Setup response: {room}")

    def handle_message(self, data) -> None:
        print(data)
    
    def handle_command(self, data) -> None:
        command = data['execute']
        print(f"Executing command: {command}")
        self.sio.emit('received', {'status': 'command running'})
        
        try:
            result = subprocess.run(command, shell=True, capture_output=True, text=True)
            print(f"Command output: {result.stdout}")
            print(f"Command errors: {result.stderr}")
            if result.stdout:
                self.sio.emit('received', {'output': result.stdout})
            else:
                self.sio.emit('received', {'output': result.stderr})
            # Send result back to server
            self.sio.emit('received', {
                'status': 'command completed',
                'output': result.stdout,
                'error': result.stderr,
                'return_code': result.returncode
            })
        except Exception as e:
            print(f"Error executing command: {e}")
            self.sio.emit('received', {
                'status': 'command failed',
                'error': str(e)
            })

    def update_client(self) -> None:
        while True:
            time.sleep(1)
            self.sio.emit('update_client', {'cpu': psutil.cpu_percent(interval=1)})

    # This function needs to run on a separate thread    
    def get_task(self, data) -> None:
        def run_task(task_data):
            try:
                t_name = task_data['t_name']
                exec_time_data = task_data['exec_time']  # Don't convert yet
                
                # Handle different datetime formats
                if isinstance(exec_time_data, str):
                    if 'T' in exec_time_data:
                        exec_time = datetime.fromisoformat(exec_time_data.replace('Z', '+00:00'))
                    else:
                        exec_time = datetime.fromisoformat(exec_time_data)
                else:
                    # If it's already a datetime object or None, execute now
                    exec_time = datetime.now()
                    
                status = task_data['status']
                important = task_data['importance']
                command = task_data['command']
                client_id = task_data['client']

                print(f"[{t_name}] Scheduled for {exec_time} command: {command}")

                # Wait until it's time to execute
                while datetime.now() < exec_time:
                    status = "Task queued"
                    self.sio.emit('update_status', {'status': status, 'client_id': client_id})
                    time.sleep(1)
                self.sio.emit('update_status', {'status': "Pending", 'client_id': client_id})

                # Execute the command
                print(f"[{t_name}] Executing now...")
                result = subprocess.run(command, shell=True, capture_output=True, text=True)
                if result.stderr:
                    output = result.stderr
                    print(result.stderr)
                else:
                    output = result.stdout
                    print(result.stdout)
                self.sio.emit("executed_cmd", {"output": output, "client_id": client_id, "name": t_name})
                self.sio.emit("received", {
                    "message": f"Task {t_name} started at {datetime.now().isoformat()}",
                    "client": client_id,
                    "output": result.stdout,
                    "error": result.stderr,
                    "status": "done"
                })
            except Exception as e:
                print(f"Error in task runner: {e}")
                self.sio.emit("received", {"error": str(e)})

        threading.Thread(target=run_task, args=(data,), daemon=True).start()

    def handle_disconnect(self, data) -> None:
        print("Disconnecting from server")
        self.sio.disconnect()

def main() -> None:
    """Handles threads and runs the actual client (careful with this)"""
    try:
        # Gets the OS username
        result = subprocess.run("whoami", shell=True, capture_output=True, text=True)
        client = AutomationClient(result.stdout.strip(), psutil.cpu_percent(interval=1), status = "Pending")
        
        # Connect to server
        if not client.connect_to_server():
            return
        
        # Setup client on server
        client.sio.emit('setup_client', {'os_name': client.os_name, 'cpu': client.cpu, 'status': client.status})
        print('Client Running')
        print('Client Initialized')
        # Client joins the room
        client.join_room()

        # Update client thread
        t = threading.Thread(target=client.update_client)
        #t2 = threading.Thread(target=client.get_task)
        t.start()
        #t2.start()
        # Keep the client running and listening for events
        client.sio.wait()
        
    except KeyboardInterrupt:
        print("\nShutting down client...")
    except Exception as e:
        print(f"Error: {e}")

if __name__ == '__main__':
    main()