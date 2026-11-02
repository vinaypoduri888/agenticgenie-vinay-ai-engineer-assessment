"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useParams } from "next/navigation";
import { apiFetch, errorMessage } from "../../../../lib/api";
import { useSession } from "../../../../lib/useSession";
import { Badge, Button, Card, Dialog, ErrorBanner, Field, Notice, PageHeader, Select, SkeletonCard, TextInput } from "../../../../components/ui";

interface Member {
  userId: string;
  role: "ADMIN" | "STAFF";
  user: { id: string; name: string; email: string };
}

export default function OrganiserTeamPage() {
  const { organiserId } = useParams<{ organiserId: string }>();
  const { user } = useSession();
  const [members, setMembers] = useState<Member[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"STAFF" | "ADMIN">("STAFF");
  const [removing, setRemoving] = useState<Member | null>(null);

  const path = `/organisers/${organiserId}/members`;

  async function load() {
    try {
      const res = await apiFetch<{ items: Member[] }>(path);
      setMembers(res.items);
    } catch (err) {
      setError(errorMessage(err, "Could not load the team."));
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organiserId]);

  async function act(run: () => Promise<string>) {
    setActionError(null);
    setNotice(null);
    try {
      setNotice(await run());
      await load();
    } catch (err) {
      setActionError(errorMessage(err, "That didn't work."));
    }
  }

  function addMember(e: FormEvent) {
    e.preventDefault();
    act(async () => {
      await apiFetch(path, { method: "POST", body: { email: email.trim(), role } });
      setEmail("");
      return `Added ${email.trim()} as ${role === "ADMIN" ? "an admin" : "staff"}.`;
    });
  }

  if (error) return <ErrorBanner message={error} />;
  if (!members) return <SkeletonCard />;

  return (
    <div>
      <PageHeader title="Team" description="Staff can check in tickets, issue refunds and see sales. Admins can also manage events and this team." />

      {notice && <Notice tone="success">{notice}</Notice>}
      {actionError && <ErrorBanner message={actionError} />}

      <Card>
        <h3>Add someone</h3>
        <form onSubmit={addMember} className="inline-form">
          <Field label="Email" htmlFor="member-email" hint="They need an account already.">
            <TextInput id="member-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} style={{ width: 260 }} />
          </Field>
          <Field label="Role" htmlFor="member-role">
            <Select id="member-role" value={role} onChange={(e) => setRole(e.target.value as "STAFF" | "ADMIN")}>
              <option value="STAFF">Staff</option>
              <option value="ADMIN">Admin</option>
            </Select>
          </Field>
          <Button type="submit" variant="secondary">
            Add
          </Button>
        </form>
      </Card>

      <div className="data-table-wrap" style={{ marginTop: 16 }}>
        <table className="data-table">
          <thead>
            <tr>
              <th>Person</th>
              <th>Role</th>
              <th aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {members.map((member) => {
              const isMe = member.userId === user?.id;
              return (
                <tr key={member.userId}>
                  <td>
                    {member.user.name} {isMe && <Badge>You</Badge>}
                    <div className="small muted">{member.user.email}</div>
                  </td>
                  <td>
                    <Select
                      aria-label={`Role for ${member.user.name}`}
                      value={member.role}
                      style={{ width: "auto" }}
                      onChange={(e) =>
                        act(async () => {
                          await apiFetch(`${path}/${member.userId}`, { method: "PATCH", body: { role: e.target.value } });
                          return `${member.user.name} is now ${e.target.value === "ADMIN" ? "an admin" : "staff"}.`;
                        })
                      }
                    >
                      <option value="STAFF">Staff</option>
                      <option value="ADMIN">Admin</option>
                    </Select>
                  </td>
                  <td className="num">
                    <Button variant="ghost" size="sm" onClick={() => setRemoving(member)}>
                      Remove
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <Dialog open={removing !== null} title="Remove from team?" onClose={() => setRemoving(null)}>
        <p>{removing?.user.name} will lose access to this organiser straight away.</p>
        <div className="dialog-actions">
          <Button variant="ghost" onClick={() => setRemoving(null)}>
            Keep them
          </Button>
          <Button
            variant="danger"
            onClick={() => {
              const member = removing!;
              setRemoving(null);
              act(async () => {
                await apiFetch(`${path}/${member.userId}`, { method: "DELETE" });
                return `Removed ${member.user.name}.`;
              });
            }}
          >
            Remove
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
