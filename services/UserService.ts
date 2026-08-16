import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database, MembershipStatus } from "@/types/database.types";

/**
 * UserService — user invitations, role assignment, active/inactive
 * toggle. Administrators never see/retrieve a user's actual password —
 * invite and reset flows only ever produce a secure link. See
 * docs/05-authentication-security.md's password-visibility boundary.
 *
 * WHICH roles a tenant HAS is Phase 4a's RoleService/roles screen, not
 * this one — this service is only about WHICH user holds WHICH role
 * (docs/07-ui-ux-screen-map.md folds "role assignment" into the Users
 * screen).
 *
 * inviteUser() MUST be called with a service-role client (see
 * lib/supabase/service-role.ts's allowed-callers list) — looking up
 * whether an email already has a profile crosses tenant boundaries,
 * which profiles_select RLS (migration 0001: "own profile, or a profile
 * sharing an active tenant with the caller") deliberately does not allow
 * an ordinary tenant admin's RLS-respecting client to do. The caller
 * (the invite server action) is responsible for checking users.create
 * itself first via the RLS-respecting client, exactly like TenantService
 * .createTenant's bootstrap sequence.
 *
 * listUsers()/setActive()/setUserRole() are RLS-respecting-client-safe —
 * tenant_memberships_select is is_tenant_member-gated (any member can
 * see the roster), *_update/insert are gated on users.edit/create.
 */
export interface TenantUserSummary {
  membershipId: string;
  profileId: string;
  fullName: string | null;
  email: string;
  status: MembershipStatus;
  isCurrentUser: boolean;
  roleNames: string[];
}

export interface InviteUserInput {
  tenantId: string;
  email: string;
  fullName: string;
  roleId: string;
  invitedBy: string;
}

export interface InviteUserResult {
  membershipId: string;
  profileId: string;
  isNewUser: boolean;
}

export class UserService {
  constructor(private readonly supabase: SupabaseClient<Database>) {}

  async inviteUser(input: InviteUserInput): Promise<InviteUserResult> {
    const { data: existingProfile, error: lookupError } = await this.supabase
      .from("profiles")
      .select("id")
      .eq("email", input.email)
      .maybeSingle();

    if (lookupError) {
      throw new Error(`UserService.inviteUser: ${lookupError.message}`);
    }

    let profileId: string;
    let isNewUser = false;

    if (existingProfile) {
      profileId = existingProfile.id;

      const { data: existingMembership } = await this.supabase
        .from("tenant_memberships")
        .select("id")
        .eq("tenant_id", input.tenantId)
        .eq("profile_id", profileId)
        .maybeSingle();

      if (existingMembership) {
        throw new Error("This person is already a member of this business");
      }
    } else {
      const { data: created, error: inviteError } = await this.supabase.auth.admin.inviteUserByEmail(
        input.email,
        { data: { full_name: input.fullName } }
      );

      if (inviteError || !created.user) {
        throw new Error(`UserService.inviteUser: ${inviteError?.message}`);
      }
      profileId = created.user.id;
      isNewUser = true;
    }

    const { data: membership, error: membershipError } = await this.supabase
      .from("tenant_memberships")
      .insert({
        tenant_id: input.tenantId,
        profile_id: profileId,
        status: "invited",
        invited_by: input.invitedBy,
      })
      .select("id")
      .single();

    if (membershipError || !membership) {
      throw new Error(`UserService.inviteUser: ${membershipError?.message}`);
    }

    const { error: assignError } = await this.supabase.from("user_role_assignments").insert({
      tenant_id: input.tenantId,
      tenant_membership_id: membership.id,
      role_id: input.roleId,
      assigned_by: input.invitedBy,
    });

    if (assignError) {
      throw new Error(`UserService.inviteUser: failed to assign role: ${assignError.message}`);
    }

    return { membershipId: membership.id, profileId, isNewUser };
  }

  /**
   * There's no dedicated users.disable-gated RLS policy -- tenant_
   * memberships_update (migration 0001) checks users.edit for every
   * mutation on the table, so the users.disable catalog entry isn't
   * independently enforced yet. Matches the app-layer gate here
   * deliberately, not a bug: same "app layer mirrors what RLS actually
   * allows" posture as the rest of this codebase, revisit only if
   * disable ever needs to be grantable without edit.
   */
  async setActive(tenantId: string, membershipId: string, active: boolean): Promise<void> {
    const { error } = await this.supabase
      .from("tenant_memberships")
      .update({ status: active ? "active" : "disabled" })
      .eq("tenant_id", tenantId)
      .eq("id", membershipId);

    if (error) {
      throw new Error(`UserService.setActive: ${error.message}`);
    }
  }

  /**
   * Full replace of this membership's role assignments, same "whole
   * desired state, not a diff" convention as RoleService.
   * setRolePermissions -- a member holds exactly one role in this UI
   * for now (the schema supports multiple/location-scoped assignments,
   * not exposed here, same deliberate v1 scoping as RoleService).
   */
  async setUserRole(
    tenantId: string,
    membershipId: string,
    roleId: string,
    assignedBy: string
  ): Promise<void> {
    const { error: deleteError } = await this.supabase
      .from("user_role_assignments")
      .delete()
      .eq("tenant_id", tenantId)
      .eq("tenant_membership_id", membershipId);

    if (deleteError) {
      throw new Error(`UserService.setUserRole: ${deleteError.message}`);
    }

    const { error: insertError } = await this.supabase.from("user_role_assignments").insert({
      tenant_id: tenantId,
      tenant_membership_id: membershipId,
      role_id: roleId,
      assigned_by: assignedBy,
    });

    if (insertError) {
      throw new Error(`UserService.setUserRole: ${insertError.message}`);
    }
  }

  async listUsers(tenantId: string, currentUserId: string): Promise<TenantUserSummary[]> {
    const { data: memberships, error: membershipsError } = await this.supabase
      .from("tenant_memberships")
      .select("id, profile_id, status, created_at")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false });

    if (membershipsError) {
      throw new Error(`UserService.listUsers: ${membershipsError.message}`);
    }
    if (!memberships || memberships.length === 0) {
      return [];
    }

    const profileIds = memberships.map((m) => m.profile_id);
    const membershipIds = memberships.map((m) => m.id);

    const [{ data: profiles }, { data: assignments }] = await Promise.all([
      this.supabase.from("profiles").select("id, full_name, email").in("id", profileIds),
      this.supabase
        .from("user_role_assignments")
        .select("tenant_membership_id, role_id")
        .in("tenant_membership_id", membershipIds),
    ]);

    const roleIds = [...new Set((assignments ?? []).map((a) => a.role_id))];
    const { data: roles } =
      roleIds.length > 0
        ? await this.supabase.from("roles").select("id, name").in("id", roleIds)
        : { data: [] as { id: string; name: string }[] };

    const roleNameById = new Map((roles ?? []).map((r) => [r.id, r.name]));
    const profileById = new Map((profiles ?? []).map((p) => [p.id, p]));
    const roleNamesByMembership = new Map<string, string[]>();
    for (const a of assignments ?? []) {
      const name = roleNameById.get(a.role_id);
      if (!name) continue;
      roleNamesByMembership.set(a.tenant_membership_id, [
        ...(roleNamesByMembership.get(a.tenant_membership_id) ?? []),
        name,
      ]);
    }

    return memberships.map((m) => {
      const profile = profileById.get(m.profile_id);
      return {
        membershipId: m.id,
        profileId: m.profile_id,
        fullName: profile?.full_name ?? null,
        email: profile?.email ?? "",
        status: m.status,
        isCurrentUser: m.profile_id === currentUserId,
        roleNames: roleNamesByMembership.get(m.id) ?? [],
      };
    });
  }
}
