export type NodeStatus = {
  peer_id: string;
  identity_address: string;
  uptime_secs: number;
  connected_peers: number;
  direct_peers: number;
  relayed_peers: number;
  nat_type: string;
  active_relays: number;
  published_count: number;
  cached_count: number;
  bootstrap_state: string;
  known_relay_count: number;
  connected_bootstrap_peers: number;
  home_relay: null | {
    peer_id: string;
    multiaddr: string;
    capability: string;
    api_url?: string | null;
  };
};

export type PublishResponse = {
  content_id: string;
  size: number;
  path?: string;
  address?: string;
  latest_sequence?: number;
};

export type PublishedContent = {
  content_id: string;
  size: number;
  path?: string | null;
  address?: string | null;
  local_sequence?: number | null;
  pin_state: string;
  relay?: null | {
    peer_id: string;
    multiaddr: string;
    api_url?: string | null;
  };
  pinned_content_id?: string | null;
  pinned_sequence?: number | null;
};

export type ResolveResponse = {
  address: string;
  identity: string;
  path: string;
  latest_sequence: number;
  content_id: string;
  reachability_hints: unknown[];
  source: string;
};

export type FetchResult = {
  data: number[];
  content_id: string;
  size: number;
};

export type HomeRelayPinResponse = {
  content_id: string;
  path?: string | null;
  relay_peer_id: string;
  relay_api_url?: string | null;
  latest_sequence?: number | null;
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/jolt-api${path}`, init);
  const contentType = response.headers.get("content-type") || "";
  const body = contentType.includes("application/json")
    ? await response.json()
    : await response.text();

  if (!response.ok) {
    const message =
      typeof body === "object" && body && "error" in body
        ? String((body as { error: unknown }).error)
        : typeof body === "string" && body.trim()
          ? body
          : `HTTP ${response.status}`;
    throw new Error(message);
  }

  return body as T;
}

export function apiErrorMessage(error: unknown) {
  if (error instanceof TypeError) {
    return "Cannot reach the Pastey dev proxy or Jolt daemon.";
  }

  if (error instanceof Error) {
    if (error.message === "HTTP 500" || error.message === "HTTP 502") {
      return "Cannot reach the Jolt daemon. Start it on the configured API port and refresh.";
    }
    return error.message;
  }

  return String(error);
}

export function getStatus() {
  return request<NodeStatus>("/status");
}

export function listPublished() {
  return request<PublishedContent[]>("/published");
}

export function publishPaste(path: string, text: string) {
  const form = new FormData();
  const file = new Blob([text], { type: "text/plain" });
  form.append("file", file, `${path.split("/").pop() || "paste"}.txt`);
  form.append("path", path);

  return request<PublishResponse>("/publish", {
    method: "POST",
    body: form
  });
}

export function resolveAddress(address: string) {
  return request<ResolveResponse>("/resolve", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ address })
  });
}

export function fetchTarget(target: string) {
  return request<FetchResult>("/fetch", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ target })
  });
}

export function pinHomeRelay(contentId: string, path?: string | null) {
  return request<HomeRelayPinResponse>("/home-relay/pins", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content_id: contentId, path })
  });
}

export function decodeFetchData(result: FetchResult) {
  return new TextDecoder().decode(new Uint8Array(result.data));
}
