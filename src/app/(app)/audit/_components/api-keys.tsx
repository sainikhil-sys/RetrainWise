"use client";

import { ArrowSquareOut, CircleNotch, Key, Plus, Trash } from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Tag } from "@/components/rw";
import { ConfirmDialog, api } from "@/components/rw-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { ago } from "@/lib/format";

type Provider = { id: string; name: string; baseUrl: string; keyUrl: string | null; prefix: string };
type SafeKey = { id: string; provider: string; label: string; baseUrl: string; last4: string; createdByEmail: string; createdAt: string; lastUsedAt: string | null };

/**
 * API keys for hosted open-source models, stored per workspace and encrypted.
 * The browser only ever sees a key's last four characters.
 */
export function ApiKeys({ initial, providers, activeBaseUrl, canManage }: { initial: SafeKey[]; providers: Provider[]; activeBaseUrl: string; canManage: boolean }) {
  const router = useRouter();
  const [keys, setKeys] = useState(initial);
  const [adding, setAdding] = useState(initial.length === 0 && canManage);
  const [provider, setProvider] = useState(providers[0]?.id ?? "groq");
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [label, setLabel] = useState("");
  const [test, setTest] = useState(true);
  const [saving, setSaving] = useState(false);
  const [remove, setRemove] = useState<SafeKey | null>(null);
  const [removing, setRemoving] = useState(false);
  const preset = providers.find((p) => p.id === provider)!;
  const norm = (u: string) => u.replace(/\/+$/, "").toLowerCase();

  async function save() {
    setSaving(true);
    try {
      const r = await api<{ keys: SafeKey[]; models: number | null }>("/api/agent/keys", {
        body: { provider, apiKey: apiKey.trim(), ...(provider === "custom" ? { baseUrl: baseUrl.trim() } : {}), ...(label.trim() ? { label: label.trim() } : {}), test },
      });
      setKeys(r.keys);
      setApiKey("");
      setLabel("");
      setAdding(false);
      toast.success("API key saved", { description: r.models != null ? `Verified: ${r.models} models available.` : "Saved without checking." });
      router.refresh();
    } catch (e) {
      toast.error("Key not saved", { description: (e as Error).message });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      {keys.length ? (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {keys.map((k) => {
            const active = norm(k.baseUrl) === norm(activeBaseUrl);
            return (
              <li key={k.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <span className="flex size-8 items-center justify-center rounded-md border border-border bg-subtle">
                  <Key size={15} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2 text-[13.5px] font-medium">
                    {k.label}
                    <span className="font-mono text-[12px] font-normal text-muted-foreground">•••• {k.last4}</span>
                    {active && <Tag tone="ok">used for explanations</Tag>}
                  </div>
                  <div className="truncate text-[12px] text-muted-foreground">
                    {k.baseUrl} · added by {k.createdByEmail} {ago(k.createdAt)} · {k.lastUsedAt ? `last used ${ago(k.lastUsedAt)}` : "not used yet"}
                  </div>
                </div>
                {canManage && (
                  <Button variant="ghost" size="sm" onClick={() => setRemove(k)} aria-label={`Remove the ${k.label} key`}>
                    <Trash /> Remove
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-[13px] text-muted-foreground">No API keys yet. Add one to use hosted open-source models such as Llama 3.3 70B or Qwen.</p>
      )}

      {canManage ? (
        adding ? (
          <div className="space-y-4 rounded-lg border border-border p-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="k-provider" className="text-[13px]">
                  Provider
                </Label>
                <Select value={provider} onValueChange={setProvider}>
                  <SelectTrigger id="k-provider" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {providers.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name}
                        {keys.some((k) => k.provider === p.id) ? " (replace saved key)" : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {preset.keyUrl && (
                  <a href={preset.keyUrl} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 text-[12px] text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
                    Create a {preset.name} key <ArrowSquareOut size={12} />
                  </a>
                )}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="k-label" className="text-[13px]">
                  Name <span className="font-normal text-muted-foreground">(optional)</span>
                </Label>
                <Input id="k-label" value={label} onChange={(e) => setLabel(e.target.value)} placeholder={preset.name} maxLength={60} />
              </div>
              {provider === "custom" && (
                <div className="space-y-1.5 sm:col-span-2">
                  <Label htmlFor="k-url" className="text-[13px]">
                    Endpoint URL
                  </Label>
                  <Input id="k-url" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://your-endpoint.example.com/v1" className="font-mono text-[12.5px]" />
                </div>
              )}
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="k-key" className="text-[13px]">
                  API key
                </Label>
                <Input
                  id="k-key"
                  type="password"
                  autoComplete="off"
                  spellCheck={false}
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder={preset.prefix ? `${preset.prefix}…` : "Paste the key"}
                  className="font-mono text-[12.5px]"
                />
                <p className="text-[12px] text-muted-foreground">Stored encrypted. After saving, only the last four characters are shown.</p>
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <label className="flex items-center gap-2 text-[13px]">
                <Switch checked={test} onCheckedChange={setTest} /> Check the key with the provider before saving
              </label>
              <div className="flex gap-2">
                <Button variant="ghost" onClick={() => setAdding(false)} disabled={saving}>
                  Cancel
                </Button>
                <Button onClick={() => void save()} disabled={saving || apiKey.trim().length < 8 || (provider === "custom" && !/^https?:\/\//.test(baseUrl.trim()))}>
                  {saving && <CircleNotch className="animate-spin" />}
                  Save key
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <Button variant="secondary" onClick={() => setAdding(true)}>
            <Plus /> Add API key
          </Button>
        )
      ) : (
        <p className="text-[12px] text-muted-foreground">Only admins can add or remove API keys.</p>
      )}

      <ConfirmDialog
        open={remove != null}
        onOpenChange={(o) => !o && setRemove(null)}
        title="Remove this API key?"
        description={remove ? `${remove.label} (•••• ${remove.last4}) is deleted from this workspace. Explanations that use ${remove.baseUrl} stop working until a new key is added.` : ""}
        confirmLabel="Remove key"
        destructive
        pending={removing}
        onConfirm={async () => {
          if (!remove) return;
          setRemoving(true);
          try {
            const r = await api<{ keys: SafeKey[] }>(`/api/agent/keys?id=${encodeURIComponent(remove.id)}`, { method: "DELETE", body: {} });
            setKeys(r.keys);
            setRemove(null);
            toast.success("API key removed");
            router.refresh();
          } catch (e) {
            toast.error("Not removed", { description: (e as Error).message });
          } finally {
            setRemoving(false);
          }
        }}
      />
    </div>
  );
}
