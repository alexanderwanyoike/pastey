import {
  Activity,
  ArrowDownToLine,
  CheckCircle2,
  Clipboard,
  Copy,
  ExternalLink,
  KeyRound,
  Link2,
  Lock,
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
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  decodePrivateOpen,
  decodeFetchData,
  apiErrorMessage,
  fetchTarget,
  getCurrentSession,
  getSessionRequestStatus,
  getStatus,
  isMissingAppSessionRequestError,
  listPublished,
  openPrivatePaste,
  pinHomeRelay,
  publishPrivatePaste,
  publishPaste,
  requestPasteySession,
  PASTEY_CAPABILITIES,
  resolveAddress,
  type AppSessionRequestResponse,
  type AppSessionStatus,
  type AppSessionStatusResponse,
  type CurrentAppSession,
  type FetchResult,
  type NodeStatus,
  type OpenPrivateResponse,
  type PublishedContent,
  type PublishResponse,
  type ResolveResponse
} from "./api";
import {
  tauriPasteyUpdateClient,
  type PasteyUpdateCheck,
  type PasteyUpdateClient
} from "./update/client";

type Toast = {
  tone: "ok" | "warn" | "err";
  message: string;
  // Connectivity toasts come from the background poll and are cleared by it
  // when the daemon recovers; action toasts belong to the user's last action
  // and must never be wiped by a background refresh.
  source?: "connectivity" | "action";
};

type FetchedPaste = {
  target: string;
  text: string;
  contentId: string;
  size: number;
  visibility: PasteVisibility;
  status: "public" | "decrypted" | "ciphertext";
  message?: string;
  resolved?: ResolveResponse;
};

type PasteVisibility = "public" | "private";

type LatestPublish = PublishResponse & {
  visibility: PasteVisibility;
  recipientCount?: number;
};

const PASTE_PREFIX = "/pastes/";
const SESSION_STORAGE_KEY = "pastey.appSession";
const PRIVATE_PATHS_STORAGE_KEY = "pastey.privatePaths";
// Keyed by requested identity so a null-identity request and a real-identity
// request never share one in-flight promise (StrictMode double-mount defusal
// must not hand a caller a session requested for the wrong identity).
const sessionRequestsInFlight = new Map<string | null, Promise<AppSessionRequestResponse>>();

type StoredSession = {
  requestId: string;
  token?: string | null;
  identity?: string | null;
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

function parseRecipients(value: string) {
  return Array.from(
    new Set(
      value
        .split(/[\s,]+/)
        .map((recipient) => recipient.trim())
        .filter(Boolean)
    )
  );
}

function hasPasteyCapabilities(capabilities: string[]) {
  return PASTEY_CAPABILITIES.every((capability) => capabilities.includes(capability));
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

async function requestPasteySessionOnce(identity: string | null) {
  let inFlight = sessionRequestsInFlight.get(identity);
  if (!inFlight) {
    inFlight = requestPasteySession(identity).finally(() => {
      sessionRequestsInFlight.delete(identity);
    });
    sessionRequestsInFlight.set(identity, inFlight);
  }
  return inFlight;
}

function loadPrivatePaths(): Set<string> {
  try {
    const raw = window.localStorage.getItem(PRIVATE_PATHS_STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    return new Set(Array.isArray(parsed) ? parsed.filter((p): p is string => typeof p === "string") : []);
  } catch {
    return new Set();
  }
}

function savePrivatePaths(paths: Set<string>) {
  try {
    window.localStorage.setItem(PRIVATE_PATHS_STORAGE_KEY, JSON.stringify([...paths]));
  } catch {
    // Best effort: losing the private/public label is cosmetic.
  }
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
    identity: response.identity ?? response.requested_identity,
    capabilities: response.capabilities,
    // A newer daemon may report a status this build does not know; degrade to
    // a readable message instead of a blank heading.
    message: messageByStatus[response.status] ?? `Session state: ${response.status}.`
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
  const [composeNotice, setComposeNotice] = useState<Toast | null>(null);
  const [title, setTitle] = useState(defaultSlug());
  const [paste, setPaste] = useState("");
  const [pasteVisibility, setPasteVisibility] = useState<PasteVisibility>("public");
  const [recipientInput, setRecipientInput] = useState("");
  const [target, setTarget] = useState("");
  const [openVisibility, setOpenVisibility] = useState<PasteVisibility>("public");
  const [latestPublish, setLatestPublish] = useState<LatestPublish | null>(null);
  const [fetched, setFetched] = useState<FetchedPaste | null>(null);
  const [privatePaths, setPrivatePaths] = useState<Set<string>>(loadPrivatePaths);
  const [refreshing, setRefreshing] = useState(false);
  const [updateCheck, setUpdateCheck] = useState<PasteyUpdateCheck | null>(null);
  const [updateAction, setUpdateAction] = useState<"check" | "install" | null>(null);
  const updateClient: PasteyUpdateClient = tauriPasteyUpdateClient;

  const pastePath = useMemo(() => `${PASTE_PREFIX}${slugify(title) || "untitled"}`, [title]);
  const recipientCount = useMemo(() => parseRecipients(recipientInput).length, [recipientInput]);
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

  async function syncSession(identity: string | null, depth = 0): Promise<string | null> {
    const stored = loadStoredSession();

    if (stored?.token) {
      try {
        const current = await getCurrentSession(stored.token);
        if (current.status === "active" && hasPasteyCapabilities(current.granted_capabilities)) {
          const activeSession = sessionFromCurrent(current, stored.token);
          saveStoredSession({
            requestId: current.request_id,
            token: stored.token,
            identity: current.identity
          });
          setSession(activeSession);
          return stored.token;
        }
        if (current.status === "active") {
          clearStoredSession();
        }
      } catch {
        // Fall through to request polling; revoked tokens are expected to fail here.
      }
    }

    if (stored?.requestId) {
      try {
        const nextResponse = await getSessionRequestStatus(stored.requestId);
        const nextSession = sessionFromStatus(nextResponse);
        if (
          nextSession.status === "active" &&
          nextSession.token &&
          hasPasteyCapabilities(nextSession.capabilities)
        ) {
          saveStoredSession({
            requestId: nextResponse.request_id,
            token: nextSession.token,
            identity: nextSession.identity
          });
          setSession(nextSession);
          return nextSession.token;
        }
        if (nextSession.status === "active" && depth === 0) {
          clearStoredSession();
          setSession({
            status: "checking",
            capabilities: [],
            message: "Requesting updated Pastey private paste permissions."
          });
          return syncSession(identity, depth + 1);
        }
        saveStoredSession({ requestId: nextResponse.request_id, identity: nextSession.identity });
        setSession(nextSession);
        return null;
      } catch (error) {
        if (!isMissingAppSessionRequestError(error)) {
          throw error;
        }
        clearStoredSession();
      }
    }

    if (!identity) {
      setSession({
        status: "checking",
        capabilities: [],
        message: "Requesting Pastey permissions for the local Jolt identity."
      });
    }

    const requested = await requestPasteySessionOnce(identity);
    saveStoredSession({ requestId: requested.request_id, identity });
    setSession({
      status: requested.status,
      requestId: requested.request_id,
      identity,
      capabilities: [],
      message: "Waiting for approval in Jolt Console."
    });
    return null;
  }

  async function refresh() {
    try {
      const stored = loadStoredSession();
      let token = await syncSession(status?.identity_address ?? session.identity ?? stored?.identity ?? null);
      let nextStatus: NodeStatus | null = null;
      let statusError: unknown = null;

      try {
        nextStatus = await getStatus();
        setStatus(nextStatus);
      } catch (error) {
        statusError = error;
      }

      if (!token && nextStatus) {
        token = await syncSession(nextStatus.identity_address);
      }
      // A transient token gap must not blank the inventory; keep the last
      // good list until a token is available again.
      if (token) {
        setPublished(await listPublished(token));
      }
      if (statusError) {
        setToast({ tone: "err", source: "connectivity", message: apiErrorMessage(statusError) });
      } else {
        // Clear only our own connectivity toast; never wipe the toast a user
        // action just raised.
        setToast((current) => (current?.source === "connectivity" ? null : current));
      }
    } catch (error) {
      setToast({ tone: "err", source: "connectivity", message: apiErrorMessage(error) });
    } finally {
      setLoading(false);
    }
  }

  // The poll always calls the freshest refresh (no stale closure), never
  // overlaps itself, and stops on unmount.
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  useEffect(() => {
    let cancelled = false;
    let inFlight = false;
    const tick = async () => {
      if (cancelled || inFlight) return;
      inFlight = true;
      try {
        await refreshRef.current();
      } finally {
        inFlight = false;
      }
    };
    void tick();
    const interval = window.setInterval(() => void tick(), 5000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, []);

  // Action toasts auto-dismiss; connectivity toasts persist until the daemon
  // recovers (the poll clears them).
  useEffect(() => {
    if (!toast || toast.source === "connectivity") return;
    const timer = window.setTimeout(() => {
      setToast((current) => (current === toast ? null : current));
    }, 6000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    savePrivatePaths(privatePaths);
  }, [privatePaths]);

  async function manualRefresh() {
    setRefreshing(true);
    try {
      await refreshRef.current();
    } finally {
      setRefreshing(false);
    }
  }

  async function requestNewSession() {
    const identity = session.identity ?? status?.identity_address ?? loadStoredSession()?.identity ?? null;
    clearStoredSession();
    setSession({
      status: "checking",
      identity,
      capabilities: [],
      message: "Requesting a new Pastey app session."
    });
    try {
      const requested = await requestPasteySessionOnce(identity);
      saveStoredSession({ requestId: requested.request_id, identity });
      setSession({
        status: requested.status,
        requestId: requested.request_id,
        identity,
        capabilities: [],
        message: "Waiting for approval in Jolt Console."
      });
    } catch (error) {
      // A failed request must not leave the panel stuck on "Requesting…"
      // with no way forward.
      const message = apiErrorMessage(error);
      setToast({ tone: "err", message });
      setSession({
        status: "expired",
        identity,
        capabilities: [],
        message: `Session request failed: ${message}`
      });
    }
  }

  async function onPublish(event: FormEvent) {
    event.preventDefault();
    if (!sessionToken) {
      setToast({ tone: "warn", message: "Approve Pastey in Jolt Console before publishing." });
      setComposeNotice({ tone: "warn", message: "Approve Pastey in Jolt Console before publishing." });
      return;
    }
    if (!paste.trim()) {
      setToast({ tone: "warn", message: "Write a paste before publishing." });
      setComposeNotice({ tone: "warn", message: "Write a paste before publishing." });
      return;
    }

    setBusy("publish");
    setComposeNotice(null);
    try {
      const recipients = parseRecipients(recipientInput);
      const response = await (pasteVisibility === "private"
        ? publishPrivatePaste(sessionToken, pastePath, paste, recipients)
        : publishPaste(sessionToken, pastePath, paste));
      const recipientCount =
        "recipient_count" in response && typeof response.recipient_count === "number"
          ? response.recipient_count
          : undefined;
      setLatestPublish({ ...response, visibility: pasteVisibility, recipientCount });
      setTarget(response.address || response.content_id);
      if (pasteVisibility === "private") {
        setPrivatePaths((current) => new Set(current).add(pastePath));
      }
      setToast({
        tone: "ok",
        message:
          pasteVisibility === "private"
            ? recipients.length === 0
              ? "Self-only encrypted paste published. Relays only see ciphertext."
              : "Encrypted paste published. Relays only see ciphertext."
            : "Paste published and signed by the local Jolt identity."
      });
      await refresh();
    } catch (error) {
      const message = apiErrorMessage(error);
      setToast({ tone: "err", message });
      setComposeNotice({ tone: "err", message });
    } finally {
      setBusy(null);
    }
  }

  async function onOpenTarget(event?: FormEvent, nextTarget = target, visibility = openVisibility) {
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
      if (visibility === "private") {
        if (!nextTarget.includes(".jolt")) {
          setToast({ tone: "warn", message: "Encrypted paste decrypt needs a .jolt paste address." });
          return;
        }
        const opened: OpenPrivateResponse = await openPrivatePaste(sessionToken, nextTarget.trim());
        const decrypted = opened.status === "decrypted";
        setFetched({
          target: nextTarget.trim(),
          text: decodePrivateOpen(opened),
          contentId: opened.content_id,
          size: opened.size,
          visibility: "private",
          status: decrypted ? "decrypted" : "ciphertext",
          message: decrypted ? undefined : opened.decrypt_error || "This daemon cannot decrypt this paste."
        });
        setToast({
          tone: decrypted ? "ok" : "err",
          message: decrypted
            ? "Encrypted paste opened and decrypted by the daemon."
            : "Encrypted bytes fetched. This daemon cannot decrypt them."
        });
        return;
      }

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
        visibility: "public",
        status: "public",
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
    try {
      await navigator.clipboard.writeText(value);
      setToast({ tone: "ok", message: "Copied." });
    } catch {
      // Clipboard access can be denied (insecure context, webview policy);
      // tell the user instead of rejecting unhandled.
      setToast({ tone: "err", message: "Could not access the clipboard." });
    }
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

  async function checkPasteyUpdate() {
    setUpdateAction("check");
    try {
      const nextUpdateCheck = await updateClient.check();
      setUpdateCheck(nextUpdateCheck);
      setToast({
        tone: nextUpdateCheck.available ? "ok" : "warn",
        message: nextUpdateCheck.available
          ? `Update available: ${nextUpdateCheck.version}`
          : "Pastey is up to date."
      });
    } catch (error) {
      setToast({ tone: "err", message: apiErrorMessage(error) });
    } finally {
      setUpdateAction(null);
    }
  }

  async function installPasteyUpdate() {
    setUpdateAction("install");
    try {
      await updateClient.installAndRelaunch();
    } catch (error) {
      setToast({ tone: "err", message: apiErrorMessage(error) });
      setUpdateAction(null);
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
            <span>Public and encrypted pastes over Jolt</span>
          </div>
        </div>
        <div className="top-actions">
          {updateCheck?.available ? (
            <button
              type="button"
              className="update-button"
              onClick={installPasteyUpdate}
              disabled={updateAction !== null}
            >
              {updateAction === "install" ? <Loader2 className="spin" size={16} /> : <ArrowDownToLine size={16} />}
              Update available
            </button>
          ) : null}
          <button
            type="button"
            className="icon-button"
            onClick={checkPasteyUpdate}
            disabled={updateAction !== null}
            aria-label="Check for Pastey updates"
            title="Check for Pastey updates"
          >
            {updateAction === "check" ? <Loader2 className="spin" size={18} /> : <ArrowDownToLine size={18} />}
          </button>
          <button
            type="button"
            className="icon-button"
            onClick={() => void manualRefresh()}
            disabled={refreshing}
            aria-label="Refresh"
          >
            {loading || refreshing ? <Loader2 className="spin" size={18} /> : <RefreshCw size={18} />}
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
            <ModeSwitch
              value={pasteVisibility}
              onChange={setPasteVisibility}
              labels={{ public: "Public", private: "Encrypted" }}
            />
            <label>
              <span>Path</span>
              <input value={title} onChange={(event) => setTitle(event.target.value)} />
            </label>
            <div className="path-preview">
              <Link2 size={15} />
              <code>{pastePath}</code>
            </div>
            {pasteVisibility === "private" ? (
              <label className="recipient-field">
                <span>
                  Recipients
                  <small>{recipientCount === 0 ? "private to me" : `${recipientCount} external`}</small>
                </span>
                <textarea
                  className="recipient-input"
                  value={recipientInput}
                  onChange={(event) => setRecipientInput(event.target.value)}
                  spellCheck={false}
                  placeholder={"Leave empty for a self-only private paste\nbobidentity.jolt\ncarolidentity.jolt"}
                />
              </label>
            ) : null}
            <label>
              <span>Text</span>
              <textarea
                value={paste}
                onChange={(event) => setPaste(event.target.value)}
                spellCheck={false}
                placeholder={
                  pasteVisibility === "private"
                    ? "Write a paste that only listed recipients and this identity can decrypt..."
                    : "Paste a command, config snippet, canary note, or anything public..."
                }
              />
            </label>
            <button className="primary-button" type="submit" disabled={busy === "publish" || !sessionToken}>
              {busy === "publish" ? <Loader2 className="spin" size={18} /> : <Send size={18} />}
              {sessionToken
                ? pasteVisibility === "private"
                  ? "Publish encrypted paste"
                  : "Publish paste"
                : blockedActionLabel}
            </button>
          </form>

          {composeNotice ? (
            <div className={`inline-message ${composeNotice.tone}`} role={composeNotice.tone === "err" ? "alert" : "status"}>
              {composeNotice.message}
            </div>
          ) : null}

          {latestPublish && (
            <div className="receipt">
              <div>
                <strong>{latestPublish.visibility === "private" ? "Encrypted paste" : "Public paste"}</strong>
                <span>
                  {bytes(latestPublish.size)}
                  {latestPublish.recipientCount
                    ? ` / ${latestPublish.recipientCount} ${latestPublish.recipientCount === 1 ? "recipient" : "recipients"}`
                    : ""}
                </span>
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
            <ModeSwitch
              value={openVisibility}
              onChange={setOpenVisibility}
              labels={{ public: "Public", private: "Encrypted" }}
            />
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
                  <span>
                    {fetched.status === "decrypted"
                      ? "Decrypted private paste"
                      : fetched.status === "ciphertext"
                        ? "Encrypted bytes fetched"
                        : "Verified public content"}
                  </span>
                  <strong>{bytes(fetched.size)}</strong>
                </div>
                <button type="button" onClick={() => copyValue(fetched.text)} aria-label="Copy fetched text">
                  <Copy size={16} />
                </button>
              </header>
              <pre>{fetched.text}</pre>
              {fetched.message ? <p className="decrypt-note">{fetched.message}</p> : null}
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
                    <span>
                      {privatePaths.has(item.path || "") ? "encrypted" : "public or unknown"} / {bytes(item.size)} / seq {item.local_sequence ?? "-"}
                    </span>
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
                      // An encrypted paste must open through decrypt regardless
                      // of the panel toggle, or the user sees raw ciphertext.
                      const visibility: PasteVisibility = privatePaths.has(item.path || "")
                        ? "private"
                        : "public";
                      setTarget(next || "");
                      setOpenVisibility(visibility);
                      if (next) void onOpenTarget(undefined, next, visibility);
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

function ModeSwitch({
  value,
  onChange,
  labels
}: {
  value: PasteVisibility;
  onChange: (value: PasteVisibility) => void;
  labels: Record<PasteVisibility, string>;
}) {
  return (
    <div className="mode-switch" role="group" aria-label="Paste visibility">
      {(["public", "private"] as const).map((mode) => (
        <button
          key={mode}
          type="button"
          className={value === mode ? "selected" : ""}
          onClick={() => onChange(mode)}
          aria-pressed={value === mode}
        >
          {mode === "private" ? <Lock size={15} /> : <Clipboard size={15} />}
          {labels[mode]}
        </button>
      ))}
    </div>
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
          <small>resolve, fetch, publish, encrypted publish/decrypt, inventory, and pin under /pastes/*</small>
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

function PinState({ state }: { state?: string | null }) {
  // pin_state is unvalidated wire data; a missing value must not throw
  // inside render (that would white-screen the app without a boundary).
  const safe = typeof state === "string" && state ? state : "unknown";
  return <span className={`pin-state ${safe}`}>{safe.replace(/_/g, " ")}</span>;
}
