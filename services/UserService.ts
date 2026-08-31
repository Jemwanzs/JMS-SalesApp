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
 *
 * acceptInvite() MUST also be called with a service-role client (see
 * lib/supabase/service-role.ts) — a newly-invited user holds no role/
 * permission on themselves yet (tenant_memberships_update is gated on
 * users.edit), so flipping their own membership from 'invited' to
 * 'active' on first login is the same class of bootstrapping problem
 * TenantService's onboarding sequence solves for a brand-new owner.
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
  redirectTo: string;
}

export interface InviteUserResult {
  membershipId: string;
  profileId: string;
  isNewUser: boolean;
}

export interface PendingInvite {
  membershipId: string;
  tenantId: string;
  tenantSlug: string;
  tenantName: string;
  roleName: string | null;
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
        { data: { full_name: input.fullName }, redirectTo: input.redirectTo }
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
   * Re-sends the invite email for a membership that's still 'invited' --
   * the person never received it, or never got around to setting up
   * their account. MUST be called with a service-role client, same
   * reason as inviteUser() itself: supabase.auth.admin.inviteUserByEmail
   * is an Admin API call, unreachable from an RLS-respecting client
   * regardless of permissions. Re-inviting an email that already has an
   * unconfirmed auth.users row is the documented way to resend/rotate
   * that invite -- it's a no-op on tenant_memberships (still 'invited',
   * nothing to update there), just a fresh email + link.
   */
  async resendInvite(tenantId: string, membershipId: string, redirectTo: string): Promise<void> {
    const { data: membership, error: membershipError } = await this.supabase
      .from("tenant_memberships")
      .select("id, status, profile_id")
      .eq("id", membershipId)
      .eq("tenant_id", tenantId)
      .maybeSingle();

    if (membershipError || !membership) {
      throw new Error("UserService.resendInvite: membership not found");
    }
    if (membership.status !== "invited") {
      throw new Error("Only a pending invite can be resent");
    }

    const { data: profile, error: profileError } = await this.supabase
      .from("profiles")
      .select("email, full_name")
      .eq("id", membership.profile_id)
      .single();

    if (profileError || !profile) {
      throw new Error("UserService.resendInvite: profile not found");
    }

    const { error: inviteError } = await this.supabase.auth.admin.inviteUserByEmail(profile.email, {
      data: { full_name: profile.full_name },
      redirectTo,
    });

    if (inviteError) {
      throw new Error(`UserService.resendInvite: ${inviteError.message}`);
    }
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
   * Completes onboarding for a just-invited user: flips their pending
   * membership to 'active'. Three WHERE clauses, none optional: `status
   * = 'invited'` (can only ever complete a genuine pending invite, never
   * reactivate a disabled member or silently no-op an already-active one
   * into looking "accepted"), `tenant_id` (scopes to the specific
   * invite), and -- the one this method was missing until a security
   * sweep caught it -- `profile_id = callerProfileId`. Without that
   * third clause, this ran as service-role with `membershipId` taken as
   * a plain, unverified argument: any authenticated user who learned or
   * guessed another pending invite's tenantId+membershipId could flip
   * THAT membership to active themselves, regardless of whose invite it
   * was. It doesn't grant login as the target (updateUser() only ever
   * touches the caller's own session), but it breaks the real invariant
   * this flow depends on -- "active" is supposed to mean the actual
   * invited person completed onboarding, not that anyone with the right
   * two IDs did. Throws if no row matched (link reused, already
   * accepted, wrong caller, or a tampered membershipId), so the caller
   * gets a clean error instead of a false "welcome" redirect.
   */
  async acceptInvite(tenantId: string, membershipId: string, callerProfileId: string): Promise<void> {
    const { data, error } = await this.supabase
      .from("tenant_memberships")
      .update({ status: "active" })
      .eq("tenant_id", tenantId)
      .eq("id", membershipId)
      .eq("profile_id", callerProfileId)
      .eq("status", "invited")
      .select("id");

    if (error) {
      throw new Error(`UserService.acceptInvite: ${error.message}`);
    }
    if (!data || data.length === 0) {
      throw new Error("This invitation has already been used or is no longer valid.");
    }
  }

  /**
   * The invite/confirm onboarding page's data source. Resolves the most
   * recently created pending invite if a profile somehow has more than
   * one -- a documented v1 limitation (no multi-invite picker UI), not
   * an oversight, matching setUserRole's own "one role for now" scoping
   * note above.
   */
  async getPendingInvite(profileId: string): Promise<PendingInvite | null> {
    const { data: membership, error: membershipError } = await this.supabase
      .from("tenant_memberships")
      .select("id, tenant_id")
      .eq("profile_id", profileId)
      .eq("status", "invited")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (membershipError) {
      throw new Error(`UserService.getPendingInvite: ${membershipError.message}`);
    }
    if (!membership) {
      return null;
    }

    const { data: tenant } = await this.supabase
      .from("tenants")
      .select("name, slug")
      .eq("id", membership.tenant_id)
      .maybeSingle();

    if (!tenant) {
      return null;
    }

    const { data: assignment } = await this.supabase
      .from("user_role_assignments")
      .select("role_id")
      .eq("tenant_membership_id", membership.id)
      .limit(1)
      .maybeSingle();

    let roleName: string | null = null;
    if (assignment) {
      const { data: role } = await this.supabase
        .from("roles")
        .select("name")
        .eq("id", assignment.role_id)
        .maybeSingle();
      roleName = role?.name ?? null;
    }

    return {
      membershipId: membership.id,
      tenantId: membership.tenant_id,
      tenantSlug: tenant.slug,
      tenantName: tenant.name,
      roleName,
    };
  }

  /**
   * Changes only `profiles.full_name` -- email, role, permissions, and
   * account identity are untouched (spec: Product Enhancements #3).
   * Delegates to the update_teammate_name SECURITY DEFINER function
   * (migration 0033) rather than a raw `.update()` -- a plain RLS UPDATE
   * policy can restrict which ROWS this touches but not which COLUMNS,
   * so a generic policy would let a Tenant Admin change a teammate's
   * email/phone/etc, not just their name (a security-sweep finding; see
   * migration 0033's header for what it replaced). The function
   * re-derives "caller holds users.edit and shares an active tenant
   * membership with an ACTIVE target" itself, so this can only ever
   * touch someone who has actually accepted their invite and completed
   * onboarding, matching the spec's "after the user has accepted the
   * invitation" scoping for free.
   */
  async updateProfileName(targetProfileId: string, fullName: string): Promise<void> {
    const { error } = await this.supabase.rpc("update_teammate_name", {
      p_target_profile_id: targetProfileId,
      p_full_name: fullName,
    });

    if (error) {
      throw new Error(`UserService.updateProfileName: ${error.message}`);
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
