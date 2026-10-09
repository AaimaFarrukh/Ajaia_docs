import { randomUUID } from 'node:crypto';
import { createUser } from './auth.js';

export const DEMO_PASSWORD = 'ajaia-demo-1';

export const DEMO_USERS = [
  { email: 'alice@ajaia.test', name: 'Alice Moreno' },
  { email: 'ben@ajaia.test', name: 'Ben Okafor' },
  { email: 'chloe@ajaia.test', name: 'Chloe Tanaka' },
];

const LAUNCH = `<h1>Q4 launch plan</h1>
<p>Goal: ship the <b>team workspace</b> to all internal pilot groups before the end of the quarter.</p>
<h2>Milestones</h2>
<ol><li>Pilot feedback closed out</li><li>Permissions review with Security</li><li>Pilot group rollout, <i>staged by department</i></li></ol>
<h2>Open questions</h2>
<ul><li>Who owns the onboarding checklist?</li><li>Do we need an export path before launch?</li><li><u>Decision needed:</u> keep the beta label or drop it</li></ul>
<p>Ben has edit access. Chloe can read along but not change anything.</p>`;

const ONBOARDING = `<h1>New hire onboarding checklist</h1>
<p>Everything a new teammate needs in their <b>first week</b>.</p>
<h2>Day one</h2>
<ul><li>Laptop and accounts</li><li>Meet your buddy</li><li>Read the team handbook</li></ul>
<h2>By Friday</h2>
<ol><li>Ship one small change</li><li>Book a 1:1 with your manager</li></ol>`;

const NOTES = `<h1>Interview notes</h1>
<p>Private notes. Not shared with anyone.</p>
<ul><li>Strong systems thinking</li><li>Asked <i>great</i> questions about the roadmap</li></ul>`;

export function seed(db) {
  if (db.prepare('SELECT COUNT(*) AS n FROM users').get().n > 0) return false;
  const ids = {};
  for (const u of DEMO_USERS) ids[u.email] = createUser(db, { ...u, password: DEMO_PASSWORD });
  const now = Date.now();
  const iso = (minsAgo) => new Date(now - minsAgo * 60e3).toISOString();
  const addDoc = (ownerEmail, title, content, minsAgo) => {
    const id = randomUUID();
    db.prepare('INSERT INTO documents (id,owner_id,title,content,created_at,updated_at,updated_by) VALUES (?,?,?,?,?,?,?)')
      .run(id, ids[ownerEmail], title, content, iso(minsAgo + 60), iso(minsAgo), ids[ownerEmail]);
    return id;
  };
  const share = (docId, email, role) =>
    db.prepare('INSERT INTO shares (doc_id,user_id,role,created_at) VALUES (?,?,?,?)').run(docId, ids[email], role, iso(30));

  const launch = addDoc('alice@ajaia.test', 'Q4 launch plan', LAUNCH, 25);
  share(launch, 'ben@ajaia.test', 'editor');
  share(launch, 'chloe@ajaia.test', 'viewer');
  const onboarding = addDoc('ben@ajaia.test', 'New hire onboarding checklist', ONBOARDING, 180);
  share(onboarding, 'alice@ajaia.test', 'editor');
  addDoc('chloe@ajaia.test', 'Interview notes', NOTES, 2900);
  return true;
}
