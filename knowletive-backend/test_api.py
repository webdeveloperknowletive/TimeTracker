import requests

resp = requests.post("http://127.0.0.1:8000/api/auth/login/", json={"username":"admin", "password":"Knowletive@123"})
print("LOGIN:", resp.status_code, resp.text)
if resp.status_code == 200:
    token = resp.json().get('token')
    headers = {"Authorization": f"Token {token}"}
    
    status_resp = requests.get("http://127.0.0.1:8000/api/tracker/status/", headers=headers)
    print("STATUS:", status_resp.status_code, status_resp.text)
