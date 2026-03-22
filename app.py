import os
from dotenv import load_dotenv
from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
import pandas as pd
from openai import OpenAI
from google import genai
import json
import re
import logging
import sqlalchemy as sa

# Set up logging
logging.basicConfig(filename='server.log', level=logging.DEBUG,
                    format='%(asctime)s %(levelname)s: %(message)s')

# --- 0. LOAD ENVIRONMENT VARIABLES ---
load_dotenv()  # This looks for the .env file in the same folder

app = Flask(__name__, static_folder='static', static_url_path='/static')
CORS(app)

@app.route('/')
def index():
    return send_from_directory('.', 'index.html')

@app.route('/styles.css')
def serve_css():
    return send_from_directory('.', 'styles.css')

@app.route('/main.js')
def serve_js():
    return send_from_directory('.', 'main.js')

# --- 1. DATA LOAD FROM POSTGRESQL (CSVs only used for first-time seeding) ---
engine = None
df_3rd_year = pd.DataFrame()
df_2nd_year = pd.DataFrame()
df_students = pd.DataFrame()

try:
    DATABASE_URL = os.getenv('DATABASE_URL', 'postgresql://genesis_user:genesis_pass@db:5432/genesis_db')
    engine = sa.create_engine(DATABASE_URL)
    insp = sa.inspect(engine)

    # --- SEED: Only runs ONCE on first boot if tables do not exist yet ---
    if not insp.has_table('3rd_year_students'):
        print("📥 Seeding 3rd_year_students table from CSV (first boot only)...")
        df_seed = pd.read_csv("student_coach_dataset_final.csv", dtype=str)
        df_seed.columns = df_seed.columns.str.strip()
        df_seed.to_sql('3rd_year_students', engine, if_exists='replace', index=False)
        print(f"   Seeded {len(df_seed)} rows into 3rd_year_students.")

    if not insp.has_table('2nd_year_students'):
        print("📥 Seeding 2nd_year_students table from CSV (first boot only)...")
        df_seed2 = pd.read_csv("2nd_year_dataset.csv", dtype=str)
        df_seed2.columns = df_seed2.columns.str.strip()
        df_seed2.to_sql('2nd_year_students', engine, if_exists='replace', index=False)
        print(f"   Seeded {len(df_seed2)} rows into 2nd_year_students.")

    if not insp.has_table('scores'):
        with engine.begin() as conn:
            conn.execute(sa.text("""
                CREATE TABLE scores (
                    reg_no TEXT PRIMARY KEY,
                    name TEXT,
                    score INT,
                    total INT,
                    submitted_at TEXT
                )
            """))
        print("   Created scores table.")

    # --- PRIMARY DATA FETCH: Always from PostgreSQL ---
    df_3rd_year = pd.read_sql_table('3rd_year_students', engine).astype(str)
    df_2nd_year = pd.read_sql_table('2nd_year_students', engine).astype(str)
    df_students = pd.concat([df_3rd_year, df_2nd_year], ignore_index=True)

    print(f"✅ System Online (PostgreSQL): {len(df_3rd_year)} 3rd-year | {len(df_2nd_year)} 2nd-year | {len(df_students)} total students.")

except Exception as e:
    print(f"❌ CRITICAL: Cannot connect to PostgreSQL. Reason: {e}")
    logging.error(f"PostgreSQL connection failed: {e}")
    print("   Falling back to local CSV files...")
    try:
        df_3rd_year = pd.read_csv("student_coach_dataset_final.csv", dtype=str)
        df_3rd_year.columns = df_3rd_year.columns.str.strip()
        df_2nd_year = pd.read_csv("2nd_year_dataset.csv", dtype=str)
        df_2nd_year.columns = df_2nd_year.columns.str.strip()
        df_students = pd.concat([df_3rd_year, df_2nd_year], ignore_index=True)
        print(f"✅ System Online (CSV Fallback): {len(df_3rd_year)} 3rd-year | {len(df_2nd_year)} 2nd-year")
    except Exception as inner_e:
        print(f"   ❌ CSV Fallback failed: {inner_e}")

# --- Calculate class-wide averages for benchmarking ---
try:
    class_avg_cgpa = round(pd.to_numeric(df_students['CGPA'], errors='coerce').mean(), 2)
except:
    class_avg_cgpa = 7.5
try:
    att_col = next((c for c in df_students.columns if 'attendance' in c.lower()), None)
    class_avg_attendance = round(pd.to_numeric(df_students[att_col], errors='coerce').mean(), 1) if att_col else 80.0
except:
    class_avg_attendance = 80.0

# --- 2. API KEYS (Pulled from .env) ---
GROQ_API_KEY = os.getenv("GROQ_API_KEY")
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")

# Initialization with the environment keys
groq_client = OpenAI(api_key=GROQ_API_KEY or "dummy_key", base_url="https://api.groq.com/openai/v1")
gemini_client = genai.Client(api_key=GEMINI_API_KEY or "dummy_key")

# Initialize JSON-backed/DB-backed skill-check scoreboard
SCORES_FILE = 'scores.json'
def load_scores():
    import json, os
    if "engine" in globals() and engine is not None:
        try:
            df_scores = pd.read_sql_table('scores', engine).astype(str)
            res = {}
            for _, r in df_scores.iterrows():
                res[r['reg_no']] = {
                    'name': r['name'],
                    'score': int(float(r['score'])),
                    'total': int(float(r['total'])),
                    'submitted_at': r['submitted_at']
                }
            return res
        except Exception as e:
            logging.error(f"DB Load Error: {e}")
    # Fallback to JSON
    if os.path.exists(SCORES_FILE):
        try:
            with open(SCORES_FILE, 'r') as f:
                return json.load(f)
        except Exception as e:
            logging.error(f"Error loading scores: {e}")
    return {}

def save_scores(data):
    import json
    with open(SCORES_FILE, 'w') as f:
        json.dump(data, f)

score_board = load_scores()

@app.route('/spotlight', methods=['POST'])
def get_spotlight():
    """Find the top student based on CGPA dynamically per dataset."""
    try:
        data = request.json or {}
        staff_id = data.get('staff_id', '').lower()

        # Determine context dataset
        if staff_id == 'thenmozhi':
            context_df = df_2nd_year
        elif staff_id == 'kavidha' or staff_id == 'admin':
            context_df = df_students
        else:
            context_df = df_3rd_year

        df = context_df.copy()

        # Dynamically find highest CGPA
        df['CGPA_num'] = pd.to_numeric(df['CGPA'], errors='coerce')
        df_sorted = df.dropna(subset=['CGPA_num']).sort_values(by='CGPA_num', ascending=False)

        if staff_id == 'kavidha' or staff_id == 'admin':
            user_row = df[df['Reg_No'].astype(str) == '731123104037']
            if not user_row.empty:
                top = user_row.iloc[0]
            elif not df_sorted.empty:
                top = df_sorted.iloc[0]
            elif not df.empty:
                top = df.iloc[0]
            else:
                return jsonify({"status": "error", "message": "No data available."})
        else:
            if not df_sorted.empty:
                top = df_sorted.iloc[0]
            elif not df.empty:
                top = df.iloc[0]
            else:
                return jsonify({"status": "error", "message": "No data available."})

        def safe(v):
            if v is None: return 'N/A'
            s = str(v).strip()
            return 'N/A' if s in ('', 'nan', 'NaN', 'None') else s

        possible_goal_cols = ['Target_Career_Role', 'Target_Career_Goal', 'Role']
        goal_col = next((c for c in possible_goal_cols if c in df.columns), None)

        return jsonify({
            "status": "success",
            "student": {
                "Name": safe(top.get('Name')),
                "CGPA": safe(top.get('CGPA')),
                "Projects": safe(top.get('Completed_Projects_Count')),
                "Career_Goal": safe(top.get(goal_col)) if goal_col else "N/A",
                "Skills": safe(top.get('Technical_Skills_Known'))
            }
        })
    except Exception as e:
        logging.error(f"Spotlight Error: {e}")
        return jsonify({"status": "error", "message": str(e)})

# --- 3. STAFF PORTAL ROUTE (/chat) ---
@app.route('/chat', methods=['POST'])
def staff_chatbot():
    try:
        data = request.json
        user_msg = data.get('message')
        staff_id = data.get('staff_id', '').lower()

        # Determine context dataset
        if staff_id == 'thenmozhi':
            context_df = df_2nd_year
        elif staff_id == 'kavidha' or staff_id == 'admin':
            context_df = df_students  # combined
        else:
            context_df = df_3rd_year  # default to 3rd year

        possible_goal_cols = ['Target_Career_Role', 'Target_Career_Goal', 'Role']
        goal_col = next((c for c in possible_goal_cols if c in context_df.columns), None)

        cols_to_show = ['Name', 'Reg_No', 'CGPA']
        if goal_col:
            cols_to_show.append(goal_col)

        # Sending the specific class data for accurate analysis
        class_summary = context_df[cols_to_show].to_string()

        prompt = f"""
        You are an Academic Data Analyst for a college class.
        CLASS DATA SUMMARY:
        {class_summary}

        STRICT FORMATTING RULES - YOU MUST FOLLOW THESE:
        - Respond in plain text ONLY. No markdown whatsoever.
        - Do NOT use asterisks (*), double asterisks (**), hashes (#), backticks, underscores for formatting.
        - Do NOT use markdown tables (|). Use simple numbered lists instead.
        - Do NOT use bullet points starting with * or -. Use numbers (1. 2. 3.) instead.
        - Write in clear, natural English sentences.
        - For charts, provide explanation and ONE JSON block only: {{"is_chart": true, "chart_type": "bar", "title": "...", "labels": [], "data": []}}
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
        prompt = f"""You are the Personal AI Mentor for {full_record.get('Name')}.
        Student Data: {json.dumps(full_record)}

        STRICT FORMATTING RULES - YOU MUST FOLLOW THESE:
        - Respond in plain text ONLY. No markdown whatsoever.
        - Do NOT use asterisks (*), double asterisks (**), hashes (#), backticks, underscores for formatting.
        - Do NOT use markdown tables (|). Present data in simple numbered sentences.
        - Do NOT use bullet points with * or -. Use numbers like 1. 2. 3. instead.
        - Write naturally as a friendly mentor speaking to a student.
        - Keep responses concise and actionable."""

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

        # Determine year based on which dataset they appear in
        is_3rd = not df_3rd_year[df_3rd_year['Reg_No'] == reg_no].empty
        is_2nd = not df_2nd_year[df_2nd_year['Reg_No'] == reg_no].empty
        year_str = "3rd Year" if is_3rd else ("2nd Year" if is_2nd else "Unknown Year")

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
                "dept": "Computer Science & Engineering",
                "year": year_str,
                "skills": student_data.get('Technical_Skills_Known'),
                "career_goal": student_data.get('Target_Career_Goal'),
                "aptitude_score": student_data.get('Aptitude_Test_Score_Avg'),
                "interview_rating": student_data.get('Mock_Interview_Rating'),
                "arrears": student_data.get('Total_Arrears_History'),
                "favorite_subject": student_data.get('Favorite_Subject'),
                "area_for_improvement": student_data.get('Area_for_Improvement'),
                "class_avg_cgpa": class_avg_cgpa,
                "class_avg_attendance": class_avg_attendance,
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

# --- 6. SKILL-CHECK SCORE SUBMISSION ---
@app.route('/student/submit_score', methods=['POST'])
def submit_score():
    try:
        data = request.json
        reg_no = str(data.get('reg_no', 'unknown')).strip()
        score  = data.get('score', 0)
        total  = data.get('total', 10)
        name   = data.get('name', 'Unknown')
        from datetime import datetime
        submitted_at = datetime.now().strftime('%H:%M, %d %b')
        score_board[reg_no] = {
            'name': name,
            'score': score,
            'total': total,
            'submitted_at': submitted_at
        }
        if "engine" in globals() and engine is not None:
            try:
                with engine.begin() as conn:
                    conn.execute(sa.text("""
                        INSERT INTO scores (reg_no, name, score, total, submitted_at)
                        VALUES (:r, :n, :s, :t, :a)
                        ON CONFLICT (reg_no) DO UPDATE SET
                            score = EXCLUDED.score, total = EXCLUDED.total, submitted_at = EXCLUDED.submitted_at
                    """), {"r": reg_no, "n": name, "s": score, "t": total, "a": submitted_at})
            except Exception as dbe:
                logging.error(f"DB Error on upload: {dbe}")
                save_scores(score_board)
        else:
            save_scores(score_board)
        logging.info(f"[SkillCheck] Student {reg_no} ({name}) scored {score}/{total}")
        return jsonify({"status": "success", "message": f"Score {score}/{total} recorded."})
    except Exception as e:
        logging.error(f"submit_score Error: {e}")
        return jsonify({"status": "error", "message": str(e)})

# --- 7. ADMIN SCORES ENDPOINT ---
@app.route('/admin/scores', methods=['POST'])
def get_scores():
    """Returns students with their skill-check submission status based on role."""
    all_students_status = []

    data = request.json or {}
    staff_id = data.get('staff_id', '').lower()

    if staff_id == 'thenmozhi':
        context_df = df_2nd_year
    elif staff_id == 'kavidha' or staff_id == 'admin':
        context_df = df_students
    else:
        context_df = df_3rd_year

    if context_df is not None and not context_df.empty:
        for _, row in context_df.iterrows():
            reg_no = str(row['Reg_No']).strip()
            name = str(row['Name']).strip()

            if reg_no in score_board:
                s = score_board[reg_no]
                all_students_status.append({
                    "reg_no": reg_no,
                    "name": name,
                    "submitted": True,
                    "score": s.get("score"),
                    "total": s.get("total"),
                    "submitted_at": s.get("submitted_at")
                })
            else:
                all_students_status.append({
                    "reg_no": reg_no,
                    "name": name,
                    "submitted": False
                })

    total_students = len(context_df) if context_df is not None else 0
    # calculate total submitted from this bounded set
    total_submitted = sum(1 for s in all_students_status if s['submitted'])
    return jsonify({
        "status": "success",
        "total_students": total_students,
        "submitted": total_submitted,
        "not_submitted": total_students - total_submitted,
        "scores": all_students_status
    })

if __name__ == '__main__':
    app.run(host="0.0.0.0", port=5000, debug=True)
