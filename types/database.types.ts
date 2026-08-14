/**
 * Hand-written PROVISIONAL types matching supabase/migrations/0001.
 *
 * Replace this file by running (once the project is linked to a real
 * Supabase project):
 *
 *   npx supabase gen types typescript --project-id <ref> > types/database.types.ts
 *
 * Do this after every migration. Never hand-edit the generated output —
 * if a shape needs to differ from the raw table, add a domain type
 * alongside this file instead (see docs/16-api-services.md).
 */

export type TenantStatus = "active" | "suspended" | "cancelled";
export type MembershipStatus = "active" | "invited" | "disabled";

export interface Database {
  public: {
    Views: Record<string, never>;
    Tables: {
      profiles: {
        Row: {
          id: string;
          full_name: string | null;
          avatar_url: string | null;
          email: string;
          phone: string | null;
          default_locale: string;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["profiles"]["Row"]> & {
          id: string;
          email: string;
        };
        Update: Partial<Database["public"]["Tables"]["profiles"]["Row"]>;
        Relationships: [];
      };
      tenants: {
        Row: {
          id: string;
          name: string;
          slug: string;
          status: TenantStatus;
          timezone: string;
          default_locale: string;
          currency: string;
          logo_url: string | null;
          business_type: string | null;
          website: string | null;
          country: string | null;
          anniversary_date: string | null;
          billing_owner_profile_id: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["tenants"]["Row"]> & {
          name: string;
          slug: string;
        };
        Update: Partial<Database["public"]["Tables"]["tenants"]["Row"]>;
        Relationships: [];
      };
      tenant_memberships: {
        Row: {
          id: string;
          tenant_id: string;
          profile_id: string;
          status: MembershipStatus;
          invited_by: string | null;
          joined_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<
          Database["public"]["Tables"]["tenant_memberships"]["Row"]
        > & { tenant_id: string; profile_id: string };
        Update: Partial<
          Database["public"]["Tables"]["tenant_memberships"]["Row"]
        >;
        Relationships: [];
      };
      tenant_settings: {
        Row: {
          tenant_id: string;
          setting_key: string;
          value: unknown;
          updated_by: string | null;
          updated_at: string;
        };
        Insert: Database["public"]["Tables"]["tenant_settings"]["Row"];
        Update: Partial<
          Database["public"]["Tables"]["tenant_settings"]["Row"]
        >;
        Relationships: [];
      };
      locations: {
        Row: {
          id: string;
          tenant_id: string;
          name: string;
          code: string | null;
          address: string | null;
          lat: number | null;
          long: number | null;
          geofence_radius_m: number | null;
          timezone: string | null;
          status: string;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["locations"]["Row"]> & {
          tenant_id: string;
          name: string;
        };
        Update: Partial<Database["public"]["Tables"]["locations"]["Row"]>;
        Relationships: [];
      };
      location_hours: {
        Row: {
          id: string;
          tenant_id: string;
          location_id: string;
          day_of_week: number;
          open_time: string | null;
          close_time: string | null;
          closed_all_day: boolean;
        };
        Insert: Partial<
          Database["public"]["Tables"]["location_hours"]["Row"]
        > & { tenant_id: string; location_id: string; day_of_week: number };
        Update: Partial<Database["public"]["Tables"]["location_hours"]["Row"]>;
        Relationships: [];
      };
      permissions: {
        Row: {
          id: string;
          key: string;
          module: string;
          description: string | null;
          is_read_only: boolean;
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["permissions"]["Row"]> & {
          key: string;
          module: string;
        };
        Update: Partial<Database["public"]["Tables"]["permissions"]["Row"]>;
        Relationships: [];
      };
      roles: {
        Row: {
          id: string;
          tenant_id: string;
          name: string;
          description: string | null;
          is_system_default: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["roles"]["Row"]> & {
          tenant_id: string;
          name: string;
        };
        Update: Partial<Database["public"]["Tables"]["roles"]["Row"]>;
        Relationships: [];
      };
      role_permissions: {
        Row: { role_id: string; permission_id: string };
        Insert: Database["public"]["Tables"]["role_permissions"]["Row"];
        Update: Partial<
          Database["public"]["Tables"]["role_permissions"]["Row"]
        >;
        Relationships: [];
      };
      user_role_assignments: {
        Row: {
          id: string;
          tenant_id: string;
          tenant_membership_id: string;
          role_id: string;
          location_id: string | null;
          assigned_by: string | null;
          assigned_at: string;
        };
        Insert: Partial<
          Database["public"]["Tables"]["user_role_assignments"]["Row"]
        > & { tenant_id: string; tenant_membership_id: string; role_id: string };
        Update: Partial<
          Database["public"]["Tables"]["user_role_assignments"]["Row"]
        >;
        Relationships: [];
      };
    };
    Functions: {
      is_tenant_member: {
        Args: { p_tenant_id: string };
        Returns: boolean;
      };
      has_permission: {
        Args: {
          p_tenant_id: string;
          p_permission_key: string;
          p_location_id?: string | null;
        };
        Returns: boolean;
      };
      get_my_permissions: {
        Args: { p_tenant_id: string };
        Returns: { permission_key: string; location_id: string | null }[];
      };
    };
  };
}
