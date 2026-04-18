import { useState } from "react";
import type { TicketPanelConfig, TicketQuestion, TicketTypeConfig } from "../../types";
import { Alert, AlertDescription } from "./ui/alert";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";

export interface GuildResources {
  guildId: string;
  roles: Array<{ id: string; name: string }>;
  categories: Array<{ id: string; name: string }>;
  textChannels: Array<{ id: string; name: string }>;
}

interface TicketPanelEditorProps {
  guildResources: GuildResources;
  value: TicketPanelConfig;
  onChange: (next: TicketPanelConfig) => void;
  onSave: () => Promise<void>;
  onPublish: () => Promise<void>;
}

function resolveName(
  list: Array<{ id: string; name: string }>,
  id: string | null | undefined
): string {
  if (!id) return "";
  return list.find((item) => item.id === id)?.name ?? id;
}

function createEmptyTicketType(index: number): TicketTypeConfig {
  return {
    id: `ticket-type-${index + 1}`,
    label: "",
    emoji: null,
    buttonStyle: "primary",
    supportRoleId: "",
    channelNamePrefix: "",
    questions: [],
  };
}

function createEmptyQuestion(index: number): TicketQuestion {
  return {
    id: `question-${index + 1}`,
    label: "",
    style: "short",
    placeholder: null,
    required: true,
  };
}

export function TicketPanelEditor({
  guildResources,
  value,
  onChange,
  onSave,
  onPublish,
}: TicketPanelEditorProps) {
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);

  const categoryName = resolveName(guildResources.categories, value.categoryChannelId);
  const transcriptName = resolveName(guildResources.textChannels, value.transcriptChannelId);

  function updateTicketType(
    ticketTypeIndex: number,
    updater: (ticketType: TicketTypeConfig) => TicketTypeConfig
  ) {
    onChange({
      ...value,
      ticketTypes: value.ticketTypes.map((ticketType, index) =>
        index === ticketTypeIndex ? updater(ticketType) : ticketType
      ),
    });
  }

  function updateQuestion(
    ticketTypeIndex: number,
    questionIndex: number,
    updater: (question: TicketQuestion) => TicketQuestion
  ) {
    updateTicketType(ticketTypeIndex, (ticketType) => ({
      ...ticketType,
      questions: ticketType.questions.map((question, index) =>
        index === questionIndex ? updater(question) : question
      ),
    }));
  }

  async function handleSave() {
    setSaving(true);
    setMessage(null);
    setError(null);
    try {
      await onSave();
      setMessage("Panel configuration saved.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save panel config.");
    } finally {
      setSaving(false);
    }
  }

  async function handlePublish() {
    setPublishing(true);
    setMessage(null);
    setError(null);
    try {
      await onPublish();
      setMessage("Panel published to Discord.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to publish panel.");
    } finally {
      setPublishing(false);
    }
  }

  return (
    <div className="space-y-4 rounded-lg border bg-muted/30 p-4 md:p-6">
      <div className="grid gap-4 md:grid-cols-2">
        <div className="min-w-0 space-y-2">
          <Label htmlFor="tp-panel-channel">Panel Channel ID</Label>
          <Input
            id="tp-panel-channel"
            value={value.panelChannelId}
            onChange={(e) => onChange({ ...value, panelChannelId: e.target.value })}
            placeholder="Channel ID where the panel message is posted"
          />
        </div>

        <div className="min-w-0 space-y-2">
          <Label htmlFor="tp-category">Ticket Category</Label>
          <select
            id="tp-category"
            className="w-full rounded-md border bg-background px-3 py-2 text-sm"
            value={value.categoryChannelId}
            onChange={(e) => onChange({ ...value, categoryChannelId: e.target.value })}
          >
            <option value="">— select a category —</option>
            {value.categoryChannelId &&
              !guildResources.categories.find((c) => c.id === value.categoryChannelId) && (
                <option value={value.categoryChannelId}>{value.categoryChannelId}</option>
              )}
            {guildResources.categories.map((cat) => (
              <option key={cat.id} value={cat.id}>
                {cat.name}
              </option>
            ))}
          </select>
          {categoryName && categoryName !== value.categoryChannelId && (
            <p className="text-xs text-muted-foreground">Selected: {categoryName}</p>
          )}
        </div>

        <div className="min-w-0 space-y-2">
          <Label htmlFor="tp-transcript">Transcript Channel</Label>
          <select
            id="tp-transcript"
            className="w-full rounded-md border bg-background px-3 py-2 text-sm"
            value={value.transcriptChannelId}
            onChange={(e) => onChange({ ...value, transcriptChannelId: e.target.value })}
          >
            <option value="">— select a channel —</option>
            {value.transcriptChannelId &&
              !guildResources.textChannels.find((c) => c.id === value.transcriptChannelId) && (
                <option value={value.transcriptChannelId}>{value.transcriptChannelId}</option>
              )}
            {guildResources.textChannels.map((ch) => (
              <option key={ch.id} value={ch.id}>
                {ch.name}
              </option>
            ))}
          </select>
          {transcriptName && transcriptName !== value.transcriptChannelId && (
            <p className="text-xs text-muted-foreground">Selected: {transcriptName}</p>
          )}
        </div>

        <div className="min-w-0 space-y-2 md:col-span-2">
          <Label htmlFor="tp-panel-title">Panel title</Label>
          <Input
            id="tp-panel-title"
            value={value.panelTitle ?? ""}
            onChange={(e) =>
              onChange({
                ...value,
                panelTitle: e.target.value.trim().length > 0 ? e.target.value : null,
              })
            }
            placeholder="Support tickets"
          />
        </div>

        <div className="min-w-0 space-y-2 md:col-span-2">
          <Label htmlFor="tp-panel-description">Panel description</Label>
          <textarea
            id="tp-panel-description"
            className="min-h-24 w-full rounded-md border bg-background px-3 py-2 text-sm"
            value={value.panelDescription ?? ""}
            onChange={(e) =>
              onChange({
                ...value,
                panelDescription: e.target.value.trim().length > 0 ? e.target.value : null,
              })
            }
            placeholder="Tell members when to use this panel and what happens after they open a ticket."
          />
        </div>

        <div className="min-w-0 space-y-2 md:col-span-2">
          <Label htmlFor="tp-panel-footer">Panel footer</Label>
          <Input
            id="tp-panel-footer"
            value={value.panelFooter ?? ""}
            onChange={(e) =>
              onChange({
                ...value,
                panelFooter: e.target.value.trim().length > 0 ? e.target.value : null,
              })
            }
            placeholder="Optional footer text shown under the panel embed"
          />
        </div>
      </div>

      <div className="space-y-3 border-t pt-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium">Ticket Types</p>
            <p className="text-xs text-muted-foreground">
              Configure the ticket button, support role, and modal questions shown to members.
            </p>
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() =>
              onChange({
                ...value,
                ticketTypes: [...value.ticketTypes, createEmptyTicketType(value.ticketTypes.length)],
              })
            }
          >
            Add ticket type
          </Button>
        </div>

        {value.ticketTypes.length === 0 ? (
          <p className="rounded-md border border-dashed bg-background px-3 py-4 text-sm text-muted-foreground">
            Add at least one ticket type so members can open tickets from the dashboard.
          </p>
        ) : (
          <div className="space-y-4">
            {value.ticketTypes.map((ticketType, ticketTypeIndex) => {
              const supportRoleName = resolveName(guildResources.roles, ticketType.supportRoleId);

              return (
                <div key={`${ticketType.id}-${ticketTypeIndex}`} className="space-y-4 rounded-md border bg-background p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium">
                        {ticketType.label || `Ticket Type ${ticketTypeIndex + 1}`}
                      </p>
                      {supportRoleName && (
                        <p className="text-xs text-muted-foreground">Support role: {supportRoleName}</p>
                      )}
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        onChange({
                          ...value,
                          ticketTypes: value.ticketTypes.filter((_, index) => index !== ticketTypeIndex),
                        })
                      }
                    >
                      Remove
                    </Button>
                  </div>

                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor={`tp-ticket-label-${ticketTypeIndex}`}>Ticket type label</Label>
                      <Input
                        id={`tp-ticket-label-${ticketTypeIndex}`}
                        value={ticketType.label}
                        onChange={(e) =>
                          updateTicketType(ticketTypeIndex, (current) => ({
                            ...current,
                            label: e.target.value,
                          }))
                        }
                        placeholder="Appeal"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor={`tp-ticket-id-${ticketTypeIndex}`}>Ticket type ID</Label>
                      <Input
                        id={`tp-ticket-id-${ticketTypeIndex}`}
                        value={ticketType.id}
                        onChange={(e) =>
                          updateTicketType(ticketTypeIndex, (current) => ({
                            ...current,
                            id: e.target.value,
                          }))
                        }
                        placeholder="appeals"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor={`tp-ticket-prefix-${ticketTypeIndex}`}>Channel name prefix</Label>
                      <Input
                        id={`tp-ticket-prefix-${ticketTypeIndex}`}
                        value={ticketType.channelNamePrefix}
                        onChange={(e) =>
                          updateTicketType(ticketTypeIndex, (current) => ({
                            ...current,
                            channelNamePrefix: e.target.value,
                          }))
                        }
                        placeholder="appeal"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor={`tp-ticket-emoji-${ticketTypeIndex}`}>Emoji</Label>
                      <Input
                        id={`tp-ticket-emoji-${ticketTypeIndex}`}
                        value={ticketType.emoji ?? ""}
                        onChange={(e) =>
                          updateTicketType(ticketTypeIndex, (current) => ({
                            ...current,
                            emoji: e.target.value || null,
                          }))
                        }
                        placeholder="🧾"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor={`tp-ticket-style-${ticketTypeIndex}`}>Button style</Label>
                      <select
                        id={`tp-ticket-style-${ticketTypeIndex}`}
                        className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                        value={ticketType.buttonStyle}
                        onChange={(e) =>
                          updateTicketType(ticketTypeIndex, (current) => ({
                            ...current,
                            buttonStyle: e.target.value as TicketTypeConfig["buttonStyle"],
                          }))
                        }
                      >
                        <option value="primary">Primary</option>
                        <option value="secondary">Secondary</option>
                        <option value="success">Success</option>
                        <option value="danger">Danger</option>
                      </select>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor={`tp-ticket-support-role-${ticketTypeIndex}`}>Support role</Label>
                      <select
                        id={`tp-ticket-support-role-${ticketTypeIndex}`}
                        className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                        value={ticketType.supportRoleId}
                        onChange={(e) =>
                          updateTicketType(ticketTypeIndex, (current) => ({
                            ...current,
                            supportRoleId: e.target.value,
                          }))
                        }
                      >
                        <option value="">— select a role —</option>
                        {ticketType.supportRoleId &&
                          !guildResources.roles.find((role) => role.id === ticketType.supportRoleId) && (
                            <option value={ticketType.supportRoleId}>{ticketType.supportRoleId}</option>
                          )}
                        {guildResources.roles.map((role) => (
                          <option key={role.id} value={role.id}>
                            {role.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className="space-y-3 rounded-md border border-dashed p-3">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium">Modal questions</p>
                        <p className="text-xs text-muted-foreground">
                          Up to five questions appear when a member opens this ticket type.
                        </p>
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          updateTicketType(ticketTypeIndex, (current) => ({
                            ...current,
                            questions: [...current.questions, createEmptyQuestion(current.questions.length)],
                          }))
                        }
                      >
                        Add question
                      </Button>
                    </div>

                    {ticketType.questions.length === 0 ? (
                      <p className="text-sm text-muted-foreground">
                        No questions configured yet. Add a question to collect ticket details from members.
                      </p>
                    ) : (
                      <div className="space-y-3">
                        {ticketType.questions.map((question, questionIndex) => (
                          <div key={`${question.id}-${questionIndex}`} className="space-y-3 rounded-md border bg-muted/30 p-3">
                            <div className="flex items-center justify-between gap-3">
                              <p className="text-sm font-medium">
                                {question.label || `Question ${questionIndex + 1}`}
                              </p>
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                onClick={() =>
                                  updateTicketType(ticketTypeIndex, (current) => ({
                                    ...current,
                                    questions: current.questions.filter((_, index) => index !== questionIndex),
                                  }))
                                }
                              >
                                Remove
                              </Button>
                            </div>

                            <div className="grid gap-4 md:grid-cols-2">
                              <div className="space-y-2">
                                <Label htmlFor={`tp-question-label-${ticketTypeIndex}-${questionIndex}`}>
                                  Question label
                                </Label>
                                <Input
                                  id={`tp-question-label-${ticketTypeIndex}-${questionIndex}`}
                                  value={question.label}
                                  onChange={(e) =>
                                    updateQuestion(ticketTypeIndex, questionIndex, (current) => ({
                                      ...current,
                                      label: e.target.value,
                                    }))
                                  }
                                  placeholder="Why are you opening this ticket?"
                                />
                              </div>
                              <div className="space-y-2">
                                <Label htmlFor={`tp-question-id-${ticketTypeIndex}-${questionIndex}`}>
                                  Question ID
                                </Label>
                                <Input
                                  id={`tp-question-id-${ticketTypeIndex}-${questionIndex}`}
                                  value={question.id}
                                  onChange={(e) =>
                                    updateQuestion(ticketTypeIndex, questionIndex, (current) => ({
                                      ...current,
                                      id: e.target.value,
                                    }))
                                  }
                                  placeholder="reason"
                                />
                              </div>
                              <div className="space-y-2">
                                <Label htmlFor={`tp-question-style-${ticketTypeIndex}-${questionIndex}`}>
                                  Question style
                                </Label>
                                <select
                                  id={`tp-question-style-${ticketTypeIndex}-${questionIndex}`}
                                  className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                                  value={question.style}
                                  onChange={(e) =>
                                    updateQuestion(ticketTypeIndex, questionIndex, (current) => ({
                                      ...current,
                                      style: e.target.value as TicketQuestion["style"],
                                    }))
                                  }
                                >
                                  <option value="short">Short</option>
                                  <option value="paragraph">Paragraph</option>
                                </select>
                              </div>
                              <div className="space-y-2">
                                <Label htmlFor={`tp-question-placeholder-${ticketTypeIndex}-${questionIndex}`}>
                                  Placeholder
                                </Label>
                                <Input
                                  id={`tp-question-placeholder-${ticketTypeIndex}-${questionIndex}`}
                                  value={question.placeholder ?? ""}
                                  onChange={(e) =>
                                    updateQuestion(ticketTypeIndex, questionIndex, (current) => ({
                                      ...current,
                                      placeholder: e.target.value || null,
                                    }))
                                  }
                                  placeholder="Explain the situation"
                                />
                              </div>
                            </div>

                            <label className="flex items-center gap-2 text-sm">
                              <input
                                type="checkbox"
                                checked={question.required}
                                onChange={(e) =>
                                  updateQuestion(ticketTypeIndex, questionIndex, (current) => ({
                                    ...current,
                                    required: e.target.checked,
                                  }))
                                }
                              />
                              Required
                            </label>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="flex flex-col gap-3 border-t pt-4 sm:flex-row sm:justify-end">
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="w-full sm:w-auto sm:min-w-[10rem]"
          disabled={saving}
          onClick={() => void handleSave()}
        >
          {saving ? "Saving…" : "Save panel config"}
        </Button>
        <Button
          type="button"
          size="sm"
          className="w-full sm:w-auto sm:min-w-[10rem]"
          disabled={publishing}
          onClick={() => void handlePublish()}
        >
          {publishing ? "Publishing…" : "Publish panel"}
        </Button>
      </div>

      {message && (
        <Alert>
          <AlertDescription>{message}</AlertDescription>
        </Alert>
      )}
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
    </div>
  );
}
