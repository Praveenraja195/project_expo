import os
from dotenv import load_dotenv
from flask import Flask, request, jsonify
from flask_cors import CORS
import pandas as pd
from openai import OpenAI
from google import genai
import json

# --- 0. LOAD ENVIRONMENT VARIABLES ---
load_dotenv()  # This looks for the .env file in the same folder

app = Flask(__name__)
CORS(app) 

# --- 1. DATA LOAD ---
try:
    df_students = pd.read_csv("student_coach_dataset_final.csv", dtype=str)
    df_students.columns = df_students.columns.str.strip()
    print(f"✅ System Online: {len(df_students)} students loaded.")
except Exception as e:
    print(f"❌ Database Error: {e}")

# --- 2. API KEYS (Pulled from .env) ---
GROQ_API_KEY = os.getenv("GROQ_API_KEY")
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")

# Initialization with the environment keys
groq_client = OpenAI(api_key=GROQ_API_KEY, base_url="https://api.groq.com/openai/v1")
gemini_client = genai.Client(api_key=GEMINI_API_KEY)

# --- 3. STAFF PORTAL ROUTE (/chat) ---
@app.route('/chat', methods=['POST'])
def staff_chatbot():
    try:
        data = request.json
        user_msg = data.get('message')

        possible_goal_cols = ['Target_Career_Role', 'Target_Career_Goal', 'Role']
        goal_col = next((c for c in possible_goal_cols if c in df_students.columns), None)
        
        cols_to_show = ['Name', 'Reg_No', 'CGPA']
        if goal_col:
            cols_to_show.append(goal_col)
            
        # Sending a safe slice of data to avoid token limits
        class_summary = df_students[cols_to_show].head(40).to_string()
        
        prompt = f"""
        You are an Academic Data Analyst.
        CLASS DATA SUMMARY:
        {class_summary}
        
        INSTRUCTIONS:
        1. Analyze class performance and career interests.
        2. For charts, return ONLY this JSON: {{"is_chart": true, "chart_type": "bar", "title": "...", "labels": [], "data": []}}
        """

        try:
            res = groq_client.chat.completions.create(
                model="llama-3.3-70b-versatile",
                messages=[{"role": "system", "content": prompt}, {"role": "user", "content": user_msg}]
            )
            reply = res.choices[0].message.content
        except:
            res = gemini_client.models.generate_content(model='gemini-2.0-flash', contents=f"{prompt}\n{user_msg}")
            reply = res.text

        try:
            chart_json = json.loads(reply)
            return jsonify({"status": "success", "type": "chart", "chart_data": chart_json})
        except:
            return jsonify({"status": "success", "type": "text", "reply": reply})

    except Exception as e:
        print(f"❌ Staff Route Error: {e}")
        return jsonify({"status": "error", "message": str(e)})

# --- 4. STUDENT PORTAL ROUTE (/student/chat) ---
@app.route('/student/chat', methods=['POST'])
def student_chatbot():
    try:
        data = request.json
        reg_no = str(data.get('reg_no')).strip()
        user_msg = data.get('message')
        
        student_row = df_students[df_students['Reg_No'] == reg_no]
        if student_row.empty:
            return jsonify({"status": "error", "message": "ID not found"}), 404
        
        full_record = student_row.to_dict(orient='records')[0]
        
        # Injects the FULL row for deep analysis
        prompt = f"You are the Personal Mentor for {full_record.get('Name')}. Full Data: {json.dumps(full_record)}"

        try:
            res = groq_client.chat.completions.create(
                model="llama-3.3-70b-versatile",
                messages=[{"role": "system", "content": prompt}, {"role": "user", "content": user_msg}]
            )
            reply = res.choices[0].message.content
        except:
            res = gemini_client.models.generate_content(model='gemini-2.5-flash', contents=f"{prompt}\n{user_msg}")
            reply = res.text

        return jsonify({"status": "success", "reply": reply})
    except Exception as e:
        print(f"❌ Student Route Error: {e}")
        return jsonify({"status": "error", "message": str(e)})

if __name__ == '__main__':
    app.run(debug=True, port=5000)