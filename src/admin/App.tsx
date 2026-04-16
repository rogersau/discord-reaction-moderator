import { useEffect, useState } from "react";
import { Button } from "./components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./components/ui/card";
import { Input } from "./components/ui/input";
import { Label } from "./components/ui/label";

interface GatewayStatus {
  status: string;
  sessionId: string | null;
  resumeGatewayUrl: string | null;
  lastSequence: number | null;
  backoffAttempt: number;
  lastError: string | null;
  heartbeatIntervalMs: number | null;
}

interface Props {
  initialAuthenticated?: boolean;
}

export default function App({ initialAuthenticated = false }: Props) {
  const [authenticated, setAuthenticated] = useState(initialAuthenticated);
  const [password, setPassword] = useState("");
  const [gatewayStatus, setGatewayStatus] = useState<GatewayStatus | null>(null);

  useEffect(() => {
    if (!authenticated) return;
    fetch("/admin/api/gateway/status")
      .then((r) => r.json())
      .then(setGatewayStatus)
      .catch(console.error);
  }, [authenticated]);

  async function handleLogin() {
    const res = await fetch("/admin/login", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: `password=${encodeURIComponent(password)}`,
      redirect: "follow",
    });
    if (res.ok || res.redirected) {
      setAuthenticated(true);
    }
  }

  async function handleGatewayStart() {
    const res = await fetch("/admin/api/gateway/start", { method: "POST" });
    if (res.ok) {
      const data: GatewayStatus = await res.json();
      setGatewayStatus(data);
    }
  }

  if (authenticated) {
    return (
      <main className="p-8 space-y-8">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">Admin Dashboard</h1>
          <Button
            variant="outline"
            onClick={async () => {
              await fetch("/admin/logout", { method: "POST" });
              window.location.href = "/admin/login";
            }}
          >
            Sign out
          </Button>
        </div>

        <section>
          <h2 className="text-xl font-semibold mb-2">Gateway</h2>
          <Card>
            <CardContent className="pt-4 space-y-2">
              {gatewayStatus ? (
                <p>Status: <strong>{gatewayStatus.status}</strong></p>
              ) : (
                <p>Loading gateway status…</p>
              )}
              <Button size="sm" onClick={handleGatewayStart}>Start gateway</Button>
            </CardContent>
          </Card>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-2">Config</h2>
          <Card>
            <CardContent className="pt-4">
              <ConfigEditor />
            </CardContent>
          </Card>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-2">Blocklist</h2>
          <Card>
            <CardContent className="pt-4">
              <BlocklistEditor />
            </CardContent>
          </Card>
        </section>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Admin Login</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleLogin()}
                placeholder="Enter admin password"
              />
            </div>
            <Button className="w-full" onClick={handleLogin}>
              Sign in
            </Button>
          </div>
        </CardContent>
      </Card>
    </main>
  );
}

function ConfigEditor() {
  const [key, setKey] = useState("bot_user_id");
  const [value, setValue] = useState("");
  const [saved, setSaved] = useState(false);

  async function handleSave() {
    const res = await fetch("/admin/api/config", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ key, value }),
    });
    if (res.ok) setSaved(true);
  }

  return (
    <div className="space-y-2">
      <div className="flex gap-2 items-end">
        <div className="space-y-1 flex-1">
          <Label htmlFor="config-key">Key</Label>
          <Input id="config-key" value={key} onChange={(e) => { setKey(e.target.value); setSaved(false); }} />
        </div>
        <div className="space-y-1 flex-1">
          <Label htmlFor="config-value">Value</Label>
          <Input id="config-value" value={value} onChange={(e) => { setValue(e.target.value); setSaved(false); }} />
        </div>
        <Button size="sm" onClick={handleSave}>Save</Button>
      </div>
      {saved && <p className="text-sm text-green-600">Saved.</p>}
    </div>
  );
}

function BlocklistEditor() {
  const [guildId, setGuildId] = useState("");
  const [emoji, setEmoji] = useState("");
  const [action, setAction] = useState<"add" | "remove">("add");
  const [result, setResult] = useState<string | null>(null);

  async function handleSubmit() {
    const res = await fetch("/admin/api/blocklist", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ guildId, emoji, action }),
    });
    if (res.ok) {
      setResult(`${action === "add" ? "Blocked" : "Unblocked"} ${emoji} in ${guildId}`);
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex gap-2 items-end flex-wrap">
        <div className="space-y-1">
          <Label htmlFor="bl-guild">Guild ID</Label>
          <Input id="bl-guild" value={guildId} onChange={(e) => setGuildId(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="bl-emoji">Emoji</Label>
          <Input id="bl-emoji" value={emoji} onChange={(e) => setEmoji(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label>Action</Label>
          <div className="flex gap-1">
            <Button size="sm" variant={action === "add" ? "default" : "outline"} onClick={() => setAction("add")}>Add</Button>
            <Button size="sm" variant={action === "remove" ? "default" : "outline"} onClick={() => setAction("remove")}>Remove</Button>
          </div>
        </div>
        <Button size="sm" onClick={handleSubmit}>Apply</Button>
      </div>
      {result && <p className="text-sm">{result}</p>}
    </div>
  );
}
