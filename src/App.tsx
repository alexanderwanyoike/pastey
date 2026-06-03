import {
  Activity,
  ArrowDownToLine,
  CheckCircle2,
  Clipboard,
  Copy,
  ExternalLink,
  KeyRound,
  Link2,
  Loader2,
  Pin,
  RadioTower,
  RefreshCw,
  Send,
  ShieldCheck,
  Sparkles,
  Terminal,
  XCircle
} from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  decodeFetchData,
  apiErrorMessage,
  fetchTarget,
  getCurrentSession,
  getSessionRequestStatus,
  getStatus,
  listPublished,
  pinHomeRelay,
  publishPaste,
  requestPasteySession,
  resolveAddress,
  type AppSessionRequestResponse,
  type AppSessionStatus,
  type AppSessionStatusResponse,
  type CurrentAppSession,
  type FetchResult,
  type NodeStatus,
  type PublishedContent,
  type PublishResponse,
  type ResolveResponse
} from "./api";

type Toast = {
  tone: "ok" | "warn" | "err";
  message: string;
};

type FetchedPaste = {
  target: string;
  text: string;
  contentId: string;
  size: number;
  resolved?: ResolveResponse;
};

const PASTE_PREFIX = "/pastes/";
const SESSION_STORAGE_KEY = "pastey.appSession";
let sessionRequestInFlight: Promise<AppSessionRequestResponse> | null = null;

type StoredSession = {
  requestId: string;
  token?: string | null;
};

type PasteySession = {
  status: AppSessionStatus | "checking";
  requestId?: string;
  token?: string | null;
  identity?: string | null;
  capabilities: string[];
  message: string;
};

function slugify(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

function short(value?: string | null, size = 12) {
  if (!value) return "-";
  if (value.length <= size * 2 + 3) return value;
  return `${value.slice(0, size)}...${value.slice(-size)}`;
}

function bytes(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function uptime(seconds: number) {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
}

function defaultSlug() {
  const now = new Date();
  const stamp = `${now.getHours()}${String(now.getMinutes()).padStart(2, "0")}`;
  return `note-${stamp}`;
}

function loadStoredSession(): StoredSession | null {
  try {
    const raw = window.localStorage.getItem(SESSION_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as StoredSession) : null;
  } catch {
    return null;
  }
}

function saveStoredSession(session: StoredSession) {
  window.localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
}

function clearStoredSession() {
  window.localStorage.removeItem(SESSION_STORAGE_KEY);
}

async function requestPasteySessionOnce(identity: string) {
  if (!sessionRequestInFlight) {
    sessionRequestInFlight = requestPasteySession(identity).finally(() => {
      sessionRequestInFlight = null;
    });
  }
  return sessionRequestInFlight;
}

function sessionFromStatus(response: AppSessionStatusResponse): PasteySession {
  const messageByStatus: Record<AppSessionStatus, string> = {
    pending: "Waiting for approval in Jolt Console.",
    active: "Approved. Pastey can use scoped Jolt app APIs.",
    rejected: "Permission was rejected in Jolt Console.",
    revoked: "Session was revoked in Jolt Console.",
    expired: "Session expired. Request permission again."
  };

  return {
    status: response.status,
    requestId: response.request_id,
    token: response.session_token,
    identity: response.identity,
    capabilities: response.capabilities,
    message: messageByStatus[response.status]
  };
}

function sessionFromCurrent(current: CurrentAppSession, token: string): PasteySession {
  return {
    status: current.status,
    requestId: current.request_id,
    token,
    identity: current.identity,
    capabilities: current.granted_capabilities,
    message: "Approved. Pastey can use scoped Jolt app APIs."
  };
}

export function App() {
  const [status, setStatus] = useState<NodeStatus | null>(null);
  const [published, setPublished] = useState<PublishedContent[]>([]);
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<PasteySession>({
    status: "checking",
    capabilities: [],
    message: "Checking Pastey app session."
  });
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const [title, setTitle] = useState(defaultSlug());
  const [paste, setPaste] = useState("");
  const [target, setTarget] = useState("");
  const [latestPublish, setLatestPublish] = useState<PublishResponse | null>(null);
  const [fetched, setFetched] = useState<FetchedPaste | null>(null);

  const pastePath = useMemo(() => `${PASTE_PREFIX}${slugify(title) || "untitled"}`, [title]);
  const sessionToken = session.status === "active" ? session.token || null : null;
  const blockedActionLabel =
    session.status === "pending"
      ? "Waiting for approval"
      : session.status === "checking"
        ? "Checking session"
        : "Session unavailable";
  const pasteItems = useMemo(
    () =>
      published
        .filter((item) => item.path?.startsWith(PASTE_PREFIX))
        .sort((a, b) => (b.local_sequence ?? -1) - (a.local_sequence ?? -1)),
    [published]
  );

  async function syncSession(nextStatus: NodeStatus): Promise<string | null> {
    const stored = loadStoredSession();

    if (stored?.token) {
      try {
        const current = await getCurrentSession(stored.token);
        if (current.status === "active") {
          const activeSession = sessionFromCurrent(current, stored.token);
          saveStoredSession({ requestId: current.request_id, token: stored.token });
          setSession(activeSession);
          return stored.token;
        }
      } catch {
        // Fall through to request polling; revoked tokens are expected to fail here.
      }
    }

    if (stored?.requestId) {
      const nextResponse = await getSessionRequestStatus(stored.requestId);
      const nextSession = sessionFromStatus(nextResponse);
      if (nextSession.status === "active" && nextSession.token) {
        saveStoredSession({ requestId: nextResponse.request_id, token: nextSession.token });
        setSession(nextSession);
        return nextSession.token;
      }
      saveStoredSession({ requestId: nextResponse.request_id });
      setSession(nextSession);
      return null;
    }

    const requested = await requestPasteySessionOnce(nextStatus.identity_address);
    saveStoredSession({ requestId: requested.request_id });
    setSession({
      status: requested.status,
      requestId: requested.request_id,
      capabilities: [],
      message: "Waiting for approval in Jolt Console."
    });
    return null;
  }

  async function refresh() {
    try {
      const nextStatus = await getStatus();
      const token = await syncSession(nextStatus);
      const nextPublished = token ? await listPublished(token) : [];
      setStatus(nextStatus);
      setPublished(nextPublished);
      setToast(null);
    } catch (error) {
      setToast({ tone: "err", message: apiErrorMessage(error) });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    const interval = window.setInterval(refresh, 5000);
    return () => window.clearInterval(interval);
  }, []);

  async function requestNewSession() {
    clearStoredSession();
    setSession({
      status: "checking",
      capabilities: [],
      message: "Requesting a new Pastey app session."
    });
    await refresh();
  }

  async function onPublish(event: FormEvent) {
    event.preventDefault();
    if (!sessionToken) {
      setToast({ tone: "warn", message: "Approve Pastey in Jolt Console before publishing." });
      return;
    }
    if (!paste.trim()) {
      setToast({ tone: "warn", message: "Write a paste before publishing." });
      return;
    }

    setBusy("publish");
    try {
      const response = await publishPaste(sessionToken, pastePath, paste);
      setLatestPublish(response);
      setTarget(response.address || response.content_id);
      setToast({ tone: "ok", message: "Paste published and signed by the local Jolt identity." });
      await refresh();
    } catch (error) {
      setToast({ tone: "err", message: apiErrorMessage(error) });
    } finally {
      setBusy(null);
    }
  }

  async function onOpenTarget(event?: FormEvent, nextTarget = target) {
    event?.preventDefault();
    if (!sessionToken) {
      setToast({ tone: "warn", message: "Approve Pastey in Jolt Console before opening pastes." });
      return;
    }
    if (!nextTarget.trim()) {
      setToast({ tone: "warn", message: "Enter a .jolt address or CID." });
      return;
    }

    setBusy("fetch");
    try {
      let resolved: ResolveResponse | undefined;
      if (nextTarget.includes(".jolt")) {
        resolved = await resolveAddress(sessionToken, nextTarget.trim());
      }
      const result: FetchResult = await fetchTarget(sessionToken, nextTarget.trim());
      setFetched({
        target: nextTarget.trim(),
        text: decodeFetchData(result),
        contentId: result.content_id,
        size: result.size,
        resolved
      });
      setToast({ tone: "ok", message: "Fetched and verified content from Jolt." });
    } catch (error) {
      setToast({ tone: "err", message: apiErrorMessage(error) });
    } finally {
      setBusy(null);
    }
  }

  async function copyValue(value?: string | null) {
    if (!value) return;
    await navigator.clipboard.writeText(value);
    setToast({ tone: "ok", message: "Copied." });
  }

  async function onPin(item: PublishedContent) {
    if (!sessionToken) {
      setToast({ tone: "warn", message: "Approve Pastey in Jolt Console before pinning." });
      return;
    }
    setBusy(`pin:${item.content_id}`);
    try {
      await pinHomeRelay(sessionToken, item.content_id, item.path);
      setToast({ tone: "ok", message: "Home relay pin requested." });
      await refresh();
    } catch (error) {
      setToast({ tone: "err", message: apiErrorMessage(error) });
    } finally {
      setBusy(null);
    }
  }

  return (
    <main className="shell">
      <header className="topbar">
        <div className="brand">
          <div className="mark">
            <Clipboard size={18} aria-hidden="true" />
          </div>
          <div>
            <p>Pastey</p>
            <span>Public paste tool over Jolt</span>
          </div>
        </div>
        <div className="top-actions">
          <button type="button" className="icon-button" onClick={refresh} aria-label="Refresh">
            {loading ? <Loader2 className="spin" size={18} /> : <RefreshCw size={18} />}
          </button>
        </div>
      </header>

      <section className="hero">
        <div>
          <p className="eyebrow">Local daemon client</p>
          <h1>Paste without a platform.</h1>
        </div>
        <div className="hero-status">
          <StatusPill ok={Boolean(status)} label={status ? "daemon online" : "daemon offline"} />
          <StatusPill ok={Boolean(sessionToken)} label={`session ${session.status}`} />
          <StatusPill
            ok={Boolean(status?.home_relay)}
            label={status?.home_relay ? "home relay set" : "no home relay"}
          />
        </div>
      </section>

      <SessionPanel session={session} onRequestAgain={requestNewSession} busy={loading} />

      {toast && (
        <div className={`toast ${toast.tone}`} role="status">
          {toast.tone === "ok" ? <CheckCircle2 size={18} /> : toast.tone === "err" ? <XCircle size={18} /> : <Activity size={18} />}
          <span>{toast.message}</span>
        </div>
      )}

      <section className="workspace">
        <aside className="panel identity-panel">
          <div className="section-title">
            <KeyRound size={18} />
            <h2>Local Identity</h2>
          </div>
          <dl className="facts">
            <div>
              <dt>Address</dt>
              <dd>{short(status?.identity_address, 14)}</dd>
            </div>
            <div>
              <dt>Peer</dt>
              <dd>{short(status?.peer_id, 10)}</dd>
            </div>
            <div>
              <dt>Uptime</dt>
              <dd>{status ? uptime(status.uptime_secs) : "-"}</dd>
            </div>
            <div>
              <dt>Peers</dt>
              <dd>{status ? status.connected_peers : "-"}</dd>
            </div>
          </dl>

          <div className="relay-strip">
            <RadioTower size={18} />
            <div>
              <span>{status?.known_relay_count ?? 0} known relays</span>
              <small>{status?.bootstrap_state || "unknown bootstrap state"}</small>
            </div>
          </div>

          <div className="note">
            <ShieldCheck size={18} />
            <p>Pastey never handles keys. It uses a scoped app session approved in Jolt Console.</p>
          </div>
        </aside>

        <section className="panel compose-panel">
          <div className="section-title">
            <Terminal size={18} />
            <h2>New Paste</h2>
          </div>
          <form onSubmit={onPublish} className="compose-form">
            <label>
              <span>Path</span>
              <input value={title} onChange={(event) => setTitle(event.target.value)} />
            </label>
            <div className="path-preview">
              <Link2 size={15} />
              <code>{pastePath}</code>
            </div>
            <label>
              <span>Text</span>
              <textarea
                value={paste}
                onChange={(event) => setPaste(event.target.value)}
                spellCheck={false}
                placeholder="Paste a command, config snippet, canary note, or anything public..."
              />
            </label>
            <button className="primary-button" type="submit" disabled={busy === "publish" || !sessionToken}>
              {busy === "publish" ? <Loader2 className="spin" size={18} /> : <Send size={18} />}
              {sessionToken ? "Publish paste" : blockedActionLabel}
            </button>
          </form>

          {latestPublish && (
            <div className="receipt">
              <div>
                <strong>Published</strong>
                <span>{bytes(latestPublish.size)}</span>
              </div>
              <button type="button" onClick={() => copyValue(latestPublish.address)}>
                <Copy size={16} />
                Copy address
              </button>
              <code>{latestPublish.address || latestPublish.content_id}</code>
            </div>
          )}
        </section>

        <section className="panel open-panel">
          <div className="section-title">
            <ArrowDownToLine size={18} />
            <h2>Open Paste</h2>
          </div>
          <form onSubmit={onOpenTarget} className="open-form">
            <input
              value={target}
              onChange={(event) => setTarget(event.target.value)}
              placeholder="identity.jolt/pastes/name or CID"
            />
            <button type="submit" disabled={busy === "fetch" || !sessionToken}>
              {busy === "fetch" ? <Loader2 className="spin" size={18} /> : <ExternalLink size={18} />}
              Open
            </button>
          </form>

          {fetched ? (
            <article className="fetched">
              <header>
                <div>
                  <span>Verified content</span>
                  <strong>{bytes(fetched.size)}</strong>
                </div>
                <button type="button" onClick={() => copyValue(fetched.text)} aria-label="Copy fetched text">
                  <Copy size={16} />
                </button>
              </header>
              <pre>{fetched.text}</pre>
              <footer>
                <code>{short(fetched.contentId, 16)}</code>
                {fetched.resolved && <span>seq {fetched.resolved.latest_sequence} from {fetched.resolved.source}</span>}
              </footer>
            </article>
          ) : (
            <div className="empty-state">
              <Sparkles size={22} />
              <p>Open a `.jolt` paste address and Pastey will resolve, fetch, and decode it.</p>
            </div>
          )}
        </section>
      </section>

      <section className="inventory">
        <div className="inventory-head">
          <div>
            <p className="eyebrow">This identity</p>
            <h2>Local pastes</h2>
          </div>
          <span>{pasteItems.length} {pasteItems.length === 1 ? "item" : "items"}</span>
        </div>

        <div className="paste-grid">
          {pasteItems.length === 0 ? (
            <div className="empty-row">No local `/pastes/*` entries yet.</div>
          ) : (
            pasteItems.map((item) => (
              <article className="paste-card" key={`${item.path}-${item.content_id}`}>
                <header>
                  <div>
                    <strong>{item.path?.replace(PASTE_PREFIX, "") || "untitled"}</strong>
                    <span>{bytes(item.size)} / seq {item.local_sequence ?? "-"}</span>
                  </div>
                  <PinState state={item.pin_state} />
                </header>
                <code>{short(item.address || item.content_id, 20)}</code>
                <footer>
                  <button type="button" onClick={() => copyValue(item.address || item.content_id)}>
                    <Copy size={15} />
                    Copy
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const next = item.address || item.content_id;
                      setTarget(next || "");
                      if (next) void onOpenTarget(undefined, next);
                    }}
                  >
                    <ExternalLink size={15} />
                    Open
                  </button>
                  <button
                    type="button"
                    disabled={!sessionToken || !status?.home_relay || busy === `pin:${item.content_id}`}
                    onClick={() => onPin(item)}
                  >
                    {busy === `pin:${item.content_id}` ? <Loader2 className="spin" size={15} /> : <Pin size={15} />}
                    Pin
                  </button>
                </footer>
              </article>
            ))
          )}
        </div>
      </section>
    </main>
  );
}

function StatusPill({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className={`status-pill ${ok ? "ok" : "warn"}`}>
      {ok ? <CheckCircle2 size={15} /> : <XCircle size={15} />}
      {label}
    </span>
  );
}

function SessionPanel({
  session,
  onRequestAgain,
  busy
}: {
  session: PasteySession;
  onRequestAgain: () => void;
  busy: boolean;
}) {
  const terminalState = ["rejected", "revoked", "expired"].includes(session.status);

  return (
    <section className={`session-panel ${session.status}`}>
      <div>
        <p className="eyebrow">App session</p>
        <h2>{session.message}</h2>
        {session.requestId ? <code>{session.requestId}</code> : null}
      </div>
      <div className="session-authority">
        {session.identity ? <span>{short(session.identity, 16)}</span> : null}
        {session.capabilities.length > 0 ? (
          <small>{session.capabilities.join(" / ")}</small>
        ) : (
          <small>resolve, fetch, publish, inventory, and pin under /pastes/*</small>
        )}
      </div>
      {terminalState ? (
        <button type="button" onClick={onRequestAgain} disabled={busy}>
          Request again
        </button>
      ) : null}
    </section>
  );
}

function PinState({ state }: { state: string }) {
  const label = state.replace(/_/g, " ");
  return <span className={`pin-state ${state}`}>{label}</span>;
}
