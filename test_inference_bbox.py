import os
from inference_sdk import InferenceHTTPClient
from dotenv import load_dotenv

load_dotenv("backend/.env")

client = InferenceHTTPClient(
    api_url="https://detect.roboflow.com",
    api_key=os.environ.get("ROBOFLOW_API_KEY", "")
)

frame_path = "backend/validation_packages/run_20260321_200744/20240526141452SHOT0023/screenshots/11_trigger_frame_00235.jpg"
if os.path.exists(frame_path):
    res = client.infer(frame_path, model_id="claytargets-id/3")
    print("Roboflow prediction for clay-targets:")
    for p in res.get("predictions", []):
        print(p)
else:
    print("File not found")