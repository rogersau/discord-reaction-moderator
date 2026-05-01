import { useState } from "react";
import type { TicketPanelConfig, TicketQuestion, TicketTypeConfig } from "../../types";
import { Alert, AlertDescription } from "./ui/alert";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { MarkdownEditor } from "./markdown-editor";

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

function getTicketTypeKey(ticketType: TicketTypeConfig, index: number) {
  return `${ticketType.id}-${index}`;
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
  const [openTicketTypes, setOpenTicketTypes] = useState<Set<string>>(
    () => new Set(value.ticketTypes.slice(0, 1).map(getTicketTypeKey))
  );
  const [openQuestions, setOpenQuestions] = useState<Set<string>>(() => new Set());

  const panelChannelName = resolveName(guildResources.textChannels, value.panelChannelId);
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

  function getQuestionKey(ticketTypeIndex: number, question: TicketQuestion, questionIndex: number) {
    return `${getTicketTypeKey(value.ticketTypes[ticketTypeIndex], ticketTypeIndex)}:${question.id}-${questionIndex}`;
  }

  function addTicketType() {
    const nextTicketType = createEmptyTicketType(value.ticketTypes.length);
    const nextIndex = value.ticketTypes.length;
    const nextKey = getTicketTypeKey(nextTicketType, nextIndex);
    onChange({
      ...value,
      ticketTypes: [...value.ticketTypes, nextTicketType],
    });
    setOpenTicketTypes((current) => new Set(current).add(nextKey));
  }

  function addQuestion(ticketTypeIndex: number) {
    const currentTicketType = value.ticketTypes[ticketTypeIndex];
    const nextQuestion = createEmptyQuestion(currentTicketType.questions.length);
    const nextQuestionIndex = currentTicketType.questions.length;
    updateTicketType(ticketTypeIndex, (current) => ({
      ...current,
      questions: [...current.questions, nextQuestion],
    }));
    setOpenQuestions((current) =>
      new Set(current).add(getQuestionKey(ticketTypeIndex, nextQuestion, nextQuestionIndex))
    );
  }

  function setTicketTypeOpen(key: string, open: boolean) {
    setOpenTicketTypes((current) => {
      const next = new Set(current);
      if (open) {
        next.add(key);
      } else {
        next.delete(key);
      }
      return next;
    });
  }

  function setQuestionOpen(key: string, open: boolean) {
    setOpenQuestions((current) => {
      const next = new Set(current);
      if (open) {
        next.add(key);
      } else {
        next.delete(key);
      }
      return next;
    });
  }

  return (
    <div className="space-y-4 rounded-lg border bg-muted/20 p-3 md:p-4">
      <div className="grid gap-3 md:grid-cols-3">
        <div className="min-w-0 space-y-2">
          <Label className="text-xs" htmlFor="tp-panel-channel">Panel channel</Label>
          <select
            id="tp-panel-channel"
            className="h-9 w-full rounded-md border bg-background px-3 py-2 text-sm"
            value={value.panelChannelId}
            onChange={(e) => onChange({ ...value, panelChannelId: e.target.value })}
          >
            <option value="">Select a channel</option>
            {value.panelChannelId &&
              !guildResources.textChannels.find((c) => c.id === value.panelChannelId) && (
                <option value={value.panelChannelId}>{value.panelChannelId}</option>
              )}
            {guildResources.textChannels.map((ch) => (
              <option key={ch.id} value={ch.id}>
                {ch.name}
              </option>
            ))}
          </select>
          {panelChannelName && panelChannelName !== value.panelChannelId && (
            <p className="truncate text-xs text-muted-foreground">#{panelChannelName}</p>
          )}
        </div>

        <div className="min-w-0 space-y-2">
          <Label className="text-xs" htmlFor="tp-category">Ticket category</Label>
          <select
            id="tp-category"
            className="h-9 w-full rounded-md border bg-background px-3 py-2 text-sm"
            value={value.categoryChannelId}
            onChange={(e) => onChange({ ...value, categoryChannelId: e.target.value })}
          >
            <option value="">Select a category</option>
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
            <p className="truncate text-xs text-muted-foreground">{categoryName}</p>
          )}
        </div>

        <div className="min-w-0 space-y-2">
          <Label className="text-xs" htmlFor="tp-transcript">Transcript channel</Label>
          <select
            id="tp-transcript"
            className="h-9 w-full rounded-md border bg-background px-3 py-2 text-sm"
            value={value.transcriptChannelId}
            onChange={(e) => onChange({ ...value, transcriptChannelId: e.target.value })}
          >
            <option value="">Select a channel</option>
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
            <p className="truncate text-xs text-muted-foreground">#{transcriptName}</p>
          )}
        </div>

        <div className="min-w-0 space-y-2">
          <Label className="text-xs" htmlFor="tp-panel-emoji">Embed emoji</Label>
          <Input
            id="tp-panel-emoji"
            className="h-9"
            value={value.panelEmoji ?? ""}
            onChange={(e) =>
              onChange({
                ...value,
                panelEmoji: e.target.value.trim().length > 0 ? e.target.value : null,
              })
            }
            placeholder="🎫"
          />
        </div>

        <div className="min-w-0 space-y-2 md:col-span-2">
          <Label className="text-xs" htmlFor="tp-panel-title">Panel title</Label>
          <MarkdownEditor
            id="tp-panel-title"
            flavor="inline"
            multiline={false}
            value={value.panelTitle ?? ""}
            onChange={(next) =>
              onChange({
                ...value,
                panelTitle: next.trim().length > 0 ? next : null,
              })
            }
            placeholder="Support tickets"
            helpText="Embed titles support bold, italic, underline, and strikethrough."
          />
        </div>

        <div className="min-w-0 space-y-2 md:col-span-3">
          <Label className="text-xs" htmlFor="tp-panel-description">Panel description</Label>
          <MarkdownEditor
            id="tp-panel-description"
            flavor="full"
            rows={6}
            value={value.panelDescription ?? ""}
            onChange={(next) =>
              onChange({
                ...value,
                panelDescription: next.trim().length > 0 ? next : null,
              })
            }
            placeholder="Tell members when to use this panel and what happens after they open a ticket."
            helpText="Supports Discord markdown: headings, lists, quotes, links, spoilers, code, and more."
          />
        </div>

        <div className="min-w-0 space-y-2 md:col-span-3">
          <Label className="text-xs" htmlFor="tp-panel-footer">Panel footer</Label>
          <Input
            id="tp-panel-footer"
            className="h-9"
            value={value.panelFooter ?? ""}
            onChange={(e) =>
              onChange({
                ...value,
                panelFooter: e.target.value.trim().length > 0 ? e.target.value : null,
              })
            }
            placeholder="Optional footer text shown under the panel embed"
          />
          <p className="text-[11px] text-muted-foreground">Discord renders the embed footer as plain text.</p>
        </div>
      </div>

      <div className="space-y-3 border-t pt-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="text-sm font-medium">Ticket Types</p>
            <p className="text-xs text-muted-foreground">
              {value.ticketTypes.length} configured. Open one type at a time when you need the details.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {value.ticketTypes.length > 0 ? (
              <>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => setOpenTicketTypes(new Set(value.ticketTypes.map(getTicketTypeKey)))}
                >
                  Expand all
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => setOpenTicketTypes(new Set())}
                >
                  Collapse all
                </Button>
              </>
            ) : null}
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="grow sm:grow-0"
              onClick={addTicketType}
            >
              Add ticket type
            </Button>
          </div>
        </div>

        {value.ticketTypes.length === 0 ? (
          <p className="rounded-md border border-dashed bg-background px-3 py-4 text-sm text-muted-foreground">
            Add at least one ticket type so members can open tickets from the dashboard.
          </p>
        ) : (
          <div className="space-y-2">
            {value.ticketTypes.map((ticketType, ticketTypeIndex) => {
              const supportRoleName = resolveName(guildResources.roles, ticketType.supportRoleId);
              const ticketTypeKey = getTicketTypeKey(ticketType, ticketTypeIndex);
              const ticketTypeOpen = openTicketTypes.has(ticketTypeKey);

              return (
                <details
                  key={ticketTypeKey}
                  className="group rounded-md border bg-background"
                  open={ticketTypeOpen}
                  onToggle={(event) =>
                    setTicketTypeOpen(ticketTypeKey, event.currentTarget.open)
                  }
                >
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2 marker:hidden">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">
                        {ticketType.label || `Ticket Type ${ticketTypeIndex + 1}`}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {supportRoleName ? `Role: ${supportRoleName}` : "No support role"} · {ticketType.questions.length} question{ticketType.questions.length === 1 ? "" : "s"}
                      </p>
                    </div>
                    <span className="shrink-0 text-xs font-medium text-muted-foreground group-open:hidden">Open</span>
                    <span className="hidden shrink-0 text-xs font-medium text-muted-foreground group-open:inline">Close</span>
                  </summary>

                  <div className="space-y-3 border-t p-3">
                    <div className="flex justify-end">
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

                  <div className="grid gap-3 md:grid-cols-3">
                    <div className="space-y-2">
                      <Label className="text-xs" htmlFor={`tp-ticket-label-${ticketTypeIndex}`}>Ticket type label</Label>
                      <Input
                        id={`tp-ticket-label-${ticketTypeIndex}`}
                        className="h-9"
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
                      <Label className="text-xs" htmlFor={`tp-ticket-id-${ticketTypeIndex}`}>ID</Label>
                      <Input
                        id={`tp-ticket-id-${ticketTypeIndex}`}
                        className="h-9"
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
                      <Label className="text-xs" htmlFor={`tp-ticket-prefix-${ticketTypeIndex}`}>Channel prefix</Label>
                      <Input
                        id={`tp-ticket-prefix-${ticketTypeIndex}`}
                        className="h-9"
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
                      <Label className="text-xs" htmlFor={`tp-ticket-emoji-${ticketTypeIndex}`}>Emoji</Label>
                      <Input
                        id={`tp-ticket-emoji-${ticketTypeIndex}`}
                        className="h-9"
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
                      <Label className="text-xs" htmlFor={`tp-ticket-style-${ticketTypeIndex}`}>Button style</Label>
                      <select
                        id={`tp-ticket-style-${ticketTypeIndex}`}
                        className="h-9 w-full rounded-md border bg-background px-3 py-2 text-sm"
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
                      <Label className="text-xs" htmlFor={`tp-ticket-support-role-${ticketTypeIndex}`}>Support role</Label>
                      <select
                        id={`tp-ticket-support-role-${ticketTypeIndex}`}
                        className="h-9 w-full rounded-md border bg-background px-3 py-2 text-sm"
                        value={ticketType.supportRoleId}
                        onChange={(e) =>
                          updateTicketType(ticketTypeIndex, (current) => ({
                            ...current,
                            supportRoleId: e.target.value,
                          }))
                        }
                      >
                        <option value="">Select a role</option>
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

                  <div className="space-y-2 rounded-md border border-dashed p-3">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <p className="text-sm font-medium">Modal questions</p>
                        <p className="text-xs text-muted-foreground">
                          Up to five questions appear before the ticket opens.
                        </p>
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => addQuestion(ticketTypeIndex)}
                      >
                        Add question
                      </Button>
                    </div>

                    {ticketType.questions.length === 0 ? (
                      <p className="text-sm text-muted-foreground">
                        No questions configured yet. Add a question to collect ticket details from members.
                      </p>
                    ) : (
                      <div className="space-y-2">
                        {ticketType.questions.map((question, questionIndex) => {
                          const questionKey = getQuestionKey(ticketTypeIndex, question, questionIndex);
                          const questionOpen = openQuestions.has(questionKey);

                          return (
                            <details
                              key={questionKey}
                              className="group rounded-md border bg-muted/20"
                              open={questionOpen}
                              onToggle={(event) =>
                                setQuestionOpen(questionKey, event.currentTarget.open)
                              }
                            >
                              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2 marker:hidden">
                                <div className="min-w-0">
                                  <p className="truncate text-sm font-medium">
                                    {question.label || `Question ${questionIndex + 1}`}
                                  </p>
                                  <p className="text-xs text-muted-foreground">
                                    {question.style === "paragraph" ? "Paragraph" : "Short"} · {question.required ? "Required" : "Optional"}
                                  </p>
                                </div>
                                <span className="shrink-0 text-xs font-medium text-muted-foreground group-open:hidden">Open</span>
                                <span className="hidden shrink-0 text-xs font-medium text-muted-foreground group-open:inline">Close</span>
                              </summary>

                              <div className="space-y-3 border-t p-3">
                                <div className="flex justify-end">
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

                                <div className="grid gap-3 md:grid-cols-2">
                                  <div className="space-y-2">
                                    <Label className="text-xs" htmlFor={`tp-question-label-${ticketTypeIndex}-${questionIndex}`}>Question label</Label>
                                    <Input
                                      id={`tp-question-label-${ticketTypeIndex}-${questionIndex}`}
                                      className="h-9"
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
                                    <Label className="text-xs" htmlFor={`tp-question-id-${ticketTypeIndex}-${questionIndex}`}>Question ID</Label>
                                    <Input
                                      id={`tp-question-id-${ticketTypeIndex}-${questionIndex}`}
                                      className="h-9"
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
                                    <Label className="text-xs" htmlFor={`tp-question-style-${ticketTypeIndex}-${questionIndex}`}>Question style</Label>
                                    <select
                                      id={`tp-question-style-${ticketTypeIndex}-${questionIndex}`}
                                      className="h-9 w-full rounded-md border bg-background px-3 py-2 text-sm"
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
                                    <Label className="text-xs" htmlFor={`tp-question-placeholder-${ticketTypeIndex}-${questionIndex}`}>Placeholder</Label>
                                    <Input
                                      id={`tp-question-placeholder-${ticketTypeIndex}-${questionIndex}`}
                                      className="h-9"
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
                          </details>
                        );
                        })}
                      </div>
                    )}
                  </div>
                  </div>
                </details>
              );
            })}
          </div>
        )}
      </div>

      <div className="sticky bottom-0 -mx-3 flex flex-col gap-2 border-t bg-background/95 px-3 py-3 sm:flex-row sm:justify-end md:-mx-4 md:px-4">
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
