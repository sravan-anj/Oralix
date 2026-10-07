// api/chat.js – Vercel serverless function for the Oralix AI chatbot.
// Runs as a Node.js serverless function on Vercel and locally with Vite dev / Vercel dev.
// Never expose GEMINI_API_KEY to the client; it is read exclusively on the server.

import dotenv from 'dotenv';
dotenv.config();
dotenv.config({ path: '.env.local', override: true });

import { createClient } from '@supabase/supabase-js';
import { GoogleGenAI } from '@google/genai';

// ---------------------------------------------------------------------------
// Supabase – used to verify the caller's session token.
// ---------------------------------------------------------------------------
const supabaseUrl =
  process.env.SUPABASE_URL ||
  process.env.VITE_SUPABASE_URL ||
  'https://iycnohkobazaduldxiqc.supabase.co';

const supabaseServiceKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_ANON_KEY ||
  process.env.VITE_SUPABASE_ANON_KEY ||
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml5Y25vaGtvYmF6YWR1bGR4aXFjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA2NzUxMzIsImV4cCI6MjEwNjI1MTEzMn0.HhZzx9yzQGvk0LqDU5ZVk3qKKMyFMWlI3tLDsCqsPKw';

// ---------------------------------------------------------------------------
// Gemini AI client factory (dynamically checks environment variable on request)
// ---------------------------------------------------------------------------
function getAIClient() {
  const geminiKey = process.env.GEMINI_API_KEY;
  if (!geminiKey) return null;
  return new GoogleGenAI({ apiKey: geminiKey });
}

// ---------------------------------------------------------------------------
// System instruction / Oralix clinic knowledge base
// ---------------------------------------------------------------------------
const ORALIX_WORKFLOWS = `
You are the AI assistant embedded in Oralix, a dental clinic management platform.
Your job is to answer two kinds of questions:
1) How to use Oralix (give exact, practical, step-by-step UI instructions based on the workflows below).
2) General dental/oral-health education (give general information only; never diagnose or prescribe).

IMPORTANT BEHAVIOR:
- When a user asks "how do I...", "where can I...", "how can I...", "how to...", "I want to...", or similar about an Oralix feature, treat it as a platform workflow question.
- Prefer Oralix's actual labels and screens below instead of generic software advice.
- Do not invent buttons, fields, screens, or capabilities that are not listed here.
- If the exact workflow is not documented below, say that the exact configuration may differ and explain only what is known.
- Keep workflow answers concise, numbered, and actionable.
- If authentication is required, mention it clearly.
- Never request, repeat, or expose sensitive patient information in chat.

ORALIX NAVIGATION AND WORKFLOWS

APPOINTMENTS / SCHEDULING:
- Main screen: Appointments.
- Staff/admin workflow: open the Appointments section from the sidebar, then click "New Appointment".
- Patient-facing workflow: open "My Appointments & Visits" and click "Book Appointment".
- Staff booking form fields: Select Patient, Doctor, Operatory Chair, Date, Time, Duration, Procedure / Reason for Visit, Notes for Doctor.
- Patient booking form fields: Doctor, Operatory Chair, Date, Time, Duration, Procedure / Reason for Visit, Notes for Doctor.
- Available doctors include Dr. Ananya Sharma (Endodontics), Dr. Vikram Mehta (Surgery & Implants), and Dr. Priya Sen (Aesthetics & Ortho).
- Click "Confirm Appointment" to save.

PATIENTS:
- Open Patients from the sidebar. Click "Add Patient".
- The form is titled "Register New Patient".
- From a patient record, Oralix can open the patient's odontogram chart.

BILLING:
- Open Billing from the sidebar.
- Staff can click "Create Invoice"; the modal is titled "Create New Invoice".
- Patient billing provides invoice history and a "Download Tax Invoice" action.

INVENTORY:
- Open Inventory from the sidebar.
- Click "Add Stock Item" to add an inventory item.

CLINICAL NOTES:
- Open Clinical Notes from the sidebar.
- Click "New SOAP Note" (titled "Document Clinical SOAP Note").

QUEUE / CHECK-IN:
- Open Queue from the sidebar.
- Click "Check-in Patient" (titled "Check In Patient to Queue").

ODONTOGRAM / DENTAL CHART:
- Open the Dental Chart/Odontogram section and select the patient.
- Click "Save Tooth Diagnostic Record" to record findings.
- Click "Add to Treatment Plan" to link procedures to specific teeth.

REPORTS:
- Open Reports from the sidebar.
- "Export Production Report" is available from the Reports screen.

DASHBOARD:
- Provides an overview of clinic activity and can open a new appointment.

SAFETY:
- For urgent dental symptoms, advise contacting a qualified dental professional/clinic reception.
- Do not diagnose or prescribe medication.
`;

const SYSTEM_INSTRUCTION = `${ORALIX_WORKFLOWS}\n\nAnswer naturally and directly. For a simple workflow question, do not give a long disclaimer first. Start with the steps the user needs.`;

// ---------------------------------------------------------------------------
// Local workflow fallback (runs when Gemini is unavailable or not configured)
// ---------------------------------------------------------------------------
function getLocalWorkflowReply(messages) {
  const lastUserMsg = [...messages].reverse().find((m) => m.role === 'user');
  const question = (lastUserMsg?.parts?.[0]?.text || '').toLowerCase().trim();

  if (/^(hi|hello|hey|greetings|good\s*(morning|afternoon|evening)|help|who are you|what can you do)/i.test(question)) {
    return `Hello! 👋 I am your Oralix dental clinic assistant.\n\nI can help you with:\n• **Appointments & Scheduling:** Booking, rescheduling, and doctor availability\n• **Patient Records:** Adding new patients and viewing dental history\n• **Billing & Invoices:** Generating invoices and viewing billing history\n• **Clinical SOAP Notes:** Documenting diagnoses and treatments\n• **Odontogram:** Dental chart and tooth diagnostics\n• **Inventory & Queue:** Managing stock supplies and waiting room check-ins\n• **Oral Health Education:** General information on hygiene, toothaches, and procedures\n\nHow can I help you today?`;
  }

  if (/(appointment|schedule|book|visit|slot|reserve|reschedul)/i.test(question)) {
    return `**How to manage Appointments in Oralix:**\n\n**Staff / Admin Workflow:**\n1. Open **Appointments** from the sidebar navigation.\n2. Click **"New Appointment"**.\n3. Select Patient, Doctor (e.g. Dr. Ananya Sharma, Dr. Vikram Mehta, Dr. Priya Sen), Operatory Chair, Date, Time, Duration, and Procedure/Reason.\n4. Add any notes for the doctor.\n5. Click **"Confirm Appointment"**.\n\n**Patient Self-Booking:**\n1. Go to **"My Appointments & Visits"** and click **"Book Appointment"**.\n2. Choose doctor, date, time slot, and procedure.\n3. Confirm to save.`;
  }

  if (/(patient|register patient|new patient|add patient|profile)/i.test(question)) {
    return `**How to add a new Patient:**\n\n1. Open **Patients** from the sidebar navigation.\n2. Click **"Add Patient"** (form titled *"Register New Patient"*).\n3. Fill in the patient details (Full Name, Contact, DOB/Age, Medical History, Insurance).\n4. Click **"Save"** to create the record.\n5. Once created, you can access their Odontogram chart, appointment history, and billing directly from their profile.`;
  }

  if (/(billing|invoice|payment|charge|fee|cost|receipt|pricing|bill)/i.test(question)) {
    return `**How to handle Billing & Invoices:**\n\n1. Open **Billing** from the sidebar.\n2. Click **"Create Invoice"** (modal titled *"Create New Invoice"*).\n3. Select the patient, add line items/treatments, quantities, and applicable discounts/tax.\n4. Click **"Save Invoice"**.\n5. Patients can review past invoices and click **"Download Tax Invoice"** from their billing view.`;
  }

  if (/(inventory|stock|suppl|material|item|equipment)/i.test(question)) {
    return `**How to manage Clinic Inventory:**\n\n1. Open **Inventory** from the sidebar.\n2. Click **"Add Stock Item"**.\n3. Enter the item name, category, quantity, reorder threshold, and unit cost.\n4. Click **"Save"** to update your clinic stock records.`;
  }

  if (/(clinical|soap|doctor note|note|diagnosis|treatment record)/i.test(question)) {
    return `**How to document Clinical SOAP Notes:**\n\n1. Open **Clinical Notes** from the sidebar.\n2. Click **"New SOAP Note"** (titled *"Document Clinical SOAP Note"*).\n3. Fill in:\n   - **S (Subjective):** Patient complaints and symptoms\n   - **O (Objective):** Clinical examination, findings, vitals\n   - **A (Assessment):** Diagnosis\n   - **P (Plan):** Treatment steps and prescriptions\n4. Click **"Save & Sign"** to commit the record.`;
  }

  if (/(queue|check-in|checkin|waiting|reception|walk-in)/i.test(question)) {
    return `**How to Check-In Patients to Queue:**\n\n1. Open **Queue** from the sidebar.\n2. Click **"Check-in Patient"** (modal titled *"Check In Patient to Queue"*).\n3. Select the scheduled patient or add walk-in, assign chair/priority.\n4. Click **"Confirm Check-in"** to add them to the active waiting queue.`;
  }

  if (/(pain|toothache|ache|hurt|sensitive|sensitivity|swelling|bleeding|gum)/i.test(question)) {
    return `**Guidance for Tooth Pain & Sensitivity:**\n\n• Rinse gently with warm salt water.\n• For sensitivity, use a desensitizing toothpaste and avoid extreme temperatures.\n• Avoid biting on hard foods on the sensitive area.\n• Over-the-counter pain relief (ibuprofen or acetaminophen) may help temporarily.\n\n⚠️ *Important: Persistent toothache, facial swelling, or throbbing pain may indicate infection. Please contact clinic reception or schedule an appointment promptly.*`;
  }

  if (/(clean|brush|floss|hygiene|plaque|tartar|stain)/i.test(question)) {
    return `**Oral Hygiene Best Practices:**\n\n1. **Brushing:** Brush for 2 full minutes twice daily with a soft-bristled toothbrush and fluoride toothpaste.\n2. **Flossing:** Floss daily between all teeth.\n3. **Mouthwash:** Consider an antibacterial or fluoride mouthwash.\n4. **Routine Visits:** Schedule professional checkups and cleanings every 6 months.`;
  }

  if (/(cavity|caries|decay|filling)/i.test(question)) {
    return `**Dental Cavities (Caries):**\n\nCavities develop when oral bacteria produce acid that dissolves tooth enamel. Early demineralization can sometimes be remineralized with fluoride, but established cavities require composite resin fillings or inlays. Schedule a dental exam for proper evaluation.`;
  }

  if (/(root canal|endodontic)/i.test(question)) {
    return `**About Root Canal Treatment:**\n\nRoot canal therapy is performed when the internal pulp becomes inflamed or infected. The dentist removes infected tissue, disinfects the root canals, and seals them to save your natural tooth. Modern techniques make the procedure gentle and virtually painless.`;
  }

  if (/(emergency|broken|knocked out|trauma)/i.test(question)) {
    return `**Dental Emergency Protocol:**\n\n• **Knocked-out tooth:** Handle only by the crown (never touch root). If possible, gently place back in socket, or store in cold milk/saliva. See a dentist within 30–60 minutes.\n• **Broken tooth:** Rinse with warm water, apply cold compress for swelling, and bring any fragments to the dentist.\n• **Severe swelling/fever:** Seek immediate emergency dental care.`;
  }

  if (/(dental chart|odontogram|tooth chart|teeth chart|diagram|chart)/i.test(question)) {
    return `**How to use the Dental Chart / Odontogram:**\n\n1. Open **Dental Chart / Odontogram** from the sidebar.\n2. Select the patient record.\n3. Click individual teeth on the interactive dental map to inspect surfaces.\n4. Click **"Save Tooth Diagnostic Record"** to record findings.\n5. Click **"Add to Treatment Plan"** to link procedures to specific teeth.`;
  }

  if (/(report|export|analytics|revenue|production|collection)/i.test(question)) {
    return `**How to view Reports & Analytics:**\n\n1. Open **Reports** from the sidebar.\n2. Filter by date range to view Clinic Production, Collections, and Doctor Utilization.\n3. Click **"Export Production Report"** to export summary data.`;
  }

  return `I am here to guide you through Oralix and answer dental care questions!\n\nHere are some things you can ask me:\n• *"How do I book an appointment?"*\n• *"How to register a new patient?"*\n• *"How do I create a billing invoice?"*\n• *"How to document a SOAP clinical note?"*\n• *"How to use the Odontogram chart?"*\n• *"Tips for tooth sensitivity or cleaning"*`;
}

// ---------------------------------------------------------------------------
// Input validation & conversation normalization
// Ensures message history conforms to alternating user/model turns for Gemini
// ---------------------------------------------------------------------------
function parseMessages(body) {
  const incoming = body?.messages;
  if (!Array.isArray(incoming) || incoming.length === 0) {
    throw Object.assign(new Error('Please send a valid conversation.'), { statusCode: 400 });
  }
  if (incoming.length > 30) {
    throw Object.assign(new Error('Too many messages in history.'), { statusCode: 400 });
  }

  const rawList = incoming.slice(-20);
  const result = [];

  for (const m of rawList) {
    if (!['user', 'assistant'].includes(m?.role) || typeof m?.text !== 'string') {
      throw Object.assign(new Error('Invalid message format.'), { statusCode: 400 });
    }
    const role = m.role === 'assistant' ? 'model' : 'user';
    const text = String(m.text || '').trim().slice(0, 4000);
    if (!text) continue;

    // Merge adjacent turns of the same role
    if (result.length > 0 && result[result.length - 1].role === role) {
      result[result.length - 1].parts[0].text += '\n' + text;
    } else {
      result.push({ role, parts: [{ text }] });
    }
  }

  // Gemini requires the conversation to start with 'user'
  while (result.length > 0 && result[0].role !== 'user') {
    result.shift();
  }

  if (result.length === 0) {
    throw Object.assign(new Error('No valid user message found.'), { statusCode: 400 });
  }

  return result;
}

// ---------------------------------------------------------------------------
// Serverless Handler (Vercel Serverless Function & Vite Dev Middleware)
// ---------------------------------------------------------------------------
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed.' });
  }

  const contentType = req.headers['content-type'] || '';
  if (!contentType.includes('application/json')) {
    return res.status(415).json({ error: 'Content-Type must be application/json.' });
  }

  // ---------------------------------------------------------------------------
  // Supabase session verification
  // Requires a valid Bearer JWT. In non-production testing, 'dev-test-token' is allowed.
  // ---------------------------------------------------------------------------
  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: 'Authentication required. Please sign in to use the assistant.' });
  }

  const isDevTestToken = process.env.NODE_ENV !== 'production' && token === 'dev-test-token';

  if (!isDevTestToken) {
    try {
      const supabase = createClient(supabaseUrl, supabaseServiceKey);
      const { data: { user }, error: authError } = await supabase.auth.getUser(token);
      if (authError || !user) {
        return res.status(401).json({ error: 'Invalid or expired session. Please sign in again.' });
      }
    } catch (_) {
      return res.status(401).json({ error: 'Session verification failed.' });
    }
  }

  // ---------------------------------------------------------------------------
  // Parse message history and generate response
  // ---------------------------------------------------------------------------
  try {
    const history = parseMessages(req.body);
    const ai = getAIClient();

    // If Gemini API is configured, query candidate models in priority order
    if (ai) {
      const candidateModels = ['gemini-3.8-flash', 'gemini-3.5-flash', 'gemini-flash-latest'];
      for (const model of candidateModels) {
        try {
          const response = await ai.models.generateContent({
            model,
            contents: history,
            config: { systemInstruction: SYSTEM_INSTRUCTION },
          });
          const reply = response.text?.trim();
          if (reply) return res.status(200).json({ reply });
        } catch (genError) {
          console.warn(`Gemini (${model}) unavailable:`, genError?.message || genError);
        }
      }
      // All candidate models failed or returned empty; fallback to deterministic local engine
    }

    const localReply = getLocalWorkflowReply(history);
    return res.status(200).json({ reply: localReply });
  } catch (error) {
    const status = Number(error?.statusCode) || 500;
    return res.status(status).json({
      error:
        status === 400
          ? error.message
          : 'Sorry, the assistant could not answer just now. Please try again.',
    });
  }
}
