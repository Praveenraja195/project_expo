import os
from dotenv import load_dotenv
from flask import Flask, request, jsonify
from flask_cors import CORS
import pandas as pd
from openai import OpenAI
from google import genai
import json
import re
import logging

# Set up logging
logging.basicConfig(filename='server.log', level=logging.DEBUG, 
                    format='%(asctime)s %(levelname)s: %(message)s')

# --- 0. LOAD ENVIRONMENT VARIABLES ---
load_dotenv()  # This looks for the .env file in the same folder

app = Flask(__name__, static_folder='static', static_url_path='/static')
CORS(app)

@app.route('/')
def index():
    return app.send_static_file('../index.html') if os.path.exists('index.html') else "Index not found"

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
            
        # Sending the full class data (currently ~64 students) for accurate analysis
        class_summary = df_students[cols_to_show].to_string()
        
        prompt = f"""
        You are an Academic Data Analyst.
        CLASS DATA SUMMARY:
        {class_summary}
        
        INSTRUCTIONS:
        1. Analyze class performance and career interests.
        2. For charts, provide a clear explanation AND the JSON block: {{"is_chart": true, "chart_type": "bar", "title": "...", "labels": [], "data": []}}
        3. Do not include multiple different chart JSONs in one response.
        """

        try:
            res = groq_client.chat.completions.create(
                model="llama-3.3-70b-versatile",
                messages=[{"role": "system", "content": prompt}, {"role": "user", "content": user_msg}]
            )
            reply = res.choices[0].message.content
        except Exception as e:
            logging.error(f"Groq Error in staff: {e}. Falling back to Gemini.")
            try:
                res = gemini_client.models.generate_content(model='gemini-2.0-flash', contents=f"{prompt}\n{user_msg}")
                reply = res.text
            except Exception as e2:
                logging.error(f"Gemini Error in staff: {e2}")
                return jsonify({"status": "error", "message": "All AI models failed", "reply": f"AI Error: {str(e2)}"})

        # 🚀 ROBUST JSON EXTRACTION: Find the first valid JSON block { ... }
        try:
            # Using a more careful regex to find the first '{' to its matching '}'
            # This is simpler and less prone to greedy capture across multiple blocks
            matches = re.findall(r'\{.*?\}', reply, re.DOTALL)
            for m in matches:
                try:
                    chart_json = json.loads(m)
                    if chart_json.get("is_chart"):
                        return jsonify({"status": "success", "type": "chart", "chart_data": chart_json, "reply": reply})
                except:
                    continue
            
            return jsonify({"status": "success", "type": "text", "reply": reply})
        except Exception as e:
            logging.error(f"Groq/Gemini Error in staff: {e}")
            return jsonify({"status": "success", "type": "text", "reply": f"AI Error: {str(e)}"})

    except Exception as e:
        logging.error(f"Staff Route Critical Error: {e}")
        return jsonify({"status": "error", "message": str(e), "reply": "Internal Server Error. Check server.log."})

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
        except Exception as e:
            logging.error(f"Groq/Gemini Error in student: {e}")
            res = gemini_client.models.generate_content(model='gemini-2.0-flash', contents=f"{prompt}\n{user_msg}")
            reply = res.text

        return jsonify({"status": "success", "reply": reply})
    except Exception as e:
        logging.error(f"Student Route Critical Error: {e}")
        return jsonify({"status": "error", "message": str(e)})

# --- 5. STUDENT LOGIN ROUTE ---
@app.route('/student/login', methods=['POST'])
def student_login():
    try:
        data = request.json
        reg_no = str(data.get('reg_no')).strip()
        password = str(data.get('password')).strip()
        
        student_row = df_students[df_students['Reg_No'] == reg_no]
        if student_row.empty:
            return jsonify({"status": "error", "message": "Invalid Registration Number"}), 404
        
        # Get profile data
        student_data = student_row.to_dict(orient='records')[0]
        
        # Verify password (DOB)
        if str(student_data.get('DOB')).strip() != password:
            return jsonify({"status": "error", "message": "Incorrect Password (Hint: DOB)"}), 401
        
        # Return necessary fields for the dashboard
        return jsonify({
            "status": "success",
            "profile": {
                "name": student_data.get('Name'),
                "reg_no": student_data.get('Reg_No'),
                "cgpa": student_data.get('CGPA'),
                "attendance": student_data.get('Sem6_Current_Attendance_%'),
                "projects": student_data.get('Completed_Projects_Count'),
                "email": student_data.get('Email'),
                "dept": "Computer Science & Engineering", # Assuming based on CSV course codes
                "year": "3rd Year", # Assuming based on Sem 6
                "skills": student_data.get('Technical_Skills_Known'),
                "career_goal": student_data.get('Target_Career_Goal'),
                "aptitude_score": student_data.get('Aptitude_Test_Score_Avg'),
                "interview_rating": student_data.get('Mock_Interview_Rating'),
                "arrears": student_data.get('Total_Arrears_History'),
                "gpa_history": {
                    "Sem1": student_data.get('Sem1_GPA'),
                    "Sem2": student_data.get('Sem2_GPA'),
                    "Sem3": student_data.get('Sem3_GPA'),
                    "Sem4": student_data.get('Sem4_GPA'),
                    "Sem5": student_data.get('Sem5_GPA')
                }
            }
        })
    except Exception as e:
        print(f"❌ Login Error: {e}")
        return jsonify({"status": "error", "message": str(e)})

if __name__ == '__main__':
    app.run(debug=True, port=5000)