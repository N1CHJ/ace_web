# ACE Athlete: AI-Powered Fitness Coaching

ACE Athlete is a prototype platform that uses computer vision and generative AI to analyze athletic form and provide elite-level coaching feedback.

## 🚀 Project Architecture

The system is built on a modern, high-performance stack hosted on **Cloudflare**:

### 🛡️ Backend (Cloudflare Worker)
- **Runtime:** Cloudflare Workers for globally distributed API logic.
- **Database:** **Cloudflare D1** (SQLite) stores session history, rep-by-rep scores, and user metadata.
- **Storage:** **Cloudflare R2** handles raw video uploads, AI-generated overlays, and reference "ideal" data.
- **Processing:** Integrates with **Replicate** (ACE Athlete Engine) for computer vision processing and skeleton tracking.
- **Intelligence:** Uses **Gemini 2.0/1.5** via **Cloudflare AI Gateway** to provide personalized coaching tips based on performance data.

### 💻 Frontend (React)
- **Framework:** React 19 with Vite and TypeScript.
- **Analytics:** **Recharts** for performance trends and progress tracking.
- **Visuals:** Custom video player components for side-by-side analysis of user videos, AI overlays, and pro references.
- **Features:**
    - Interactive activity heatmap (activity over 12 weeks).
    - Session drill-down views with granular rep-by-rep data.
    - Analyze/Ingest workflow for adding new reference exercises.

## 🛠️ Key Workflows

1.  **Video Analysis:** Users upload a video of an exercise (e.g., Back Squat).
2.  **CV Processing:** The video is sent to Replicate, where the ACE engine tracks movement and compares it against "ideal" skeletal patterns.
3.  **AI Coaching:** A summary of the performance is sent to Gemini, which generates direct, actionable feedback based on the user's skill tier.
4.  **Dashboard Update:** Results are saved to D1/R2 and appear immediately on the athlete's dashboard.

## 📱 Mobile Experience
The platform is designed to be mobile-first, featuring a responsive bottom navigation bar and adaptive grid layouts to allow athletes to record and review sessions directly from the gym floor.

## 🔒 Roadmap
- [ ] Integration with Clerk for full user authentication.
- [ ] Support for more sports and specialized exercise "ideals."
- [ ] Real-time "Ready-to-Lift" camera feedback.

---

*This project is currently a functional prototype deployed via GitHub Actions to Cloudflare Pages and Workers.*
