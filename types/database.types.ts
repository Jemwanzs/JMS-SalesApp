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
export type PlatformAdminRole = "super_admin" | "support" | "billing_ops";
export type ProductStatus = "active" | "inactive" | "archived";
export type BusinessDayStatus = "scheduled" | "open" | "closing" | "closed" | "reopened";
export type SaleStatus = "open" | "locked" | "corrected" | "voided";
export type ApprovalRequestStatus = "pending" | "approved" | "rejected" | "expired" | "auto_approved";
export type SaleCorrectionType = "void" | "correct";

export interface VoidOrCorrectResult {
  status: "voided" | "corrected" | "pending_approval";
  approvalRequestId?: string;
  replacementSaleId?: string;
}

export interface ResolveApprovalResult {
  status: "approved" | "rejected";
  type?: string;
  replacementSaleId?: string;
}

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
      platform_admins: {
        Row: {
          id: string;
          profile_id: string;
          role: PlatformAdminRole;
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["platform_admins"]["Row"]> & {
          profile_id: string;
        };
        Update: Partial<Database["public"]["Tables"]["platform_admins"]["Row"]>;
        Relationships: [];
      };
      products: {
        Row: {
          id: string;
          tenant_id: string;
          location_id: string | null;
          sku: string | null;
          name: string;
          description: string | null;
          expected_price: number | null;
          show_expected_price: boolean;
          image_url: string | null;
          display_order: number;
          status: ProductStatus;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["products"]["Row"]> & {
          tenant_id: string;
          name: string;
        };
        Update: Partial<Database["public"]["Tables"]["products"]["Row"]>;
        Relationships: [];
      };
      product_images: {
        Row: {
          id: string;
          tenant_id: string;
          product_id: string;
          storage_path: string;
          width: number | null;
          height: number | null;
          is_primary: boolean;
          created_at: string;
        };
        Insert: Partial<
          Database["public"]["Tables"]["product_images"]["Row"]
        > & { tenant_id: string; product_id: string; storage_path: string };
        Update: Partial<Database["public"]["Tables"]["product_images"]["Row"]>;
        Relationships: [];
      };
      business_days: {
        Row: {
          id: string;
          tenant_id: string;
          location_id: string;
          business_date: string;
          status: BusinessDayStatus;
          scheduled_open_time: string | null;
          scheduled_close_time: string | null;
          opened_at: string | null;
          opened_by: string | null;
          closed_at: string | null;
          closed_by: string | null;
          opening_reason: string | null;
          closing_reason: string | null;
          reopened_at: string | null;
          reopened_by: string | null;
          reopen_expires_at: string | null;
          aggregates: Record<string, unknown>;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<
          Database["public"]["Tables"]["business_days"]["Row"]
        > & { tenant_id: string; location_id: string; business_date: string };
        Update: Partial<Database["public"]["Tables"]["business_days"]["Row"]>;
        Relationships: [];
      };
      sales: {
        Row: {
          id: string;
          tenant_id: string;
          location_id: string;
          business_day_id: string;
          product_id: string;
          sale_number: string | null;
          barcode_reference: string | null;
          product_name_snapshot: string;
          product_image_snapshot: string | null;
          expected_price_snapshot: number | null;
          actual_amount: number;
          quantity: number | null;
          notes: string | null;
          recorded_by: string;
          sale_date: string;
          sale_time: string;
          status: SaleStatus;
          idempotency_key: string;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["sales"]["Row"]> & {
          tenant_id: string;
          location_id: string;
          business_day_id: string;
          product_id: string;
          product_name_snapshot: string;
          actual_amount: number;
          recorded_by: string;
          sale_date: string;
          idempotency_key: string;
        };
        Update: Partial<Database["public"]["Tables"]["sales"]["Row"]>;
        Relationships: [];
      };
      approval_requests: {
        Row: {
          id: string;
          tenant_id: string;
          type: string;
          requested_by: string;
          request_payload: Record<string, unknown>;
          status: ApprovalRequestStatus;
          reviewed_by: string | null;
          reviewed_at: string | null;
          review_notes: string | null;
          resolution_payload: Record<string, unknown> | null;
          expires_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["approval_requests"]["Row"]> & {
          tenant_id: string;
          type: string;
          requested_by: string;
        };
        Update: Partial<Database["public"]["Tables"]["approval_requests"]["Row"]>;
        Relationships: [];
      };
      sale_corrections: {
        Row: {
          id: string;
          tenant_id: string;
          sale_id: string;
          correction_type: SaleCorrectionType;
          old_values: Record<string, unknown>;
          new_values: Record<string, unknown> | null;
          reason: string;
          requested_by: string;
          approved_by: string | null;
          approval_request_id: string | null;
          replacement_sale_id: string | null;
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["sale_corrections"]["Row"]> & {
          tenant_id: string;
          sale_id: string;
          correction_type: SaleCorrectionType;
          old_values: Record<string, unknown>;
          reason: string;
          requested_by: string;
        };
        Update: Partial<Database["public"]["Tables"]["sale_corrections"]["Row"]>;
        Relationships: [];
      };
    };
    Functions: {
      void_sale: {
        Args: { p_sale_id: string; p_reason: string };
        Returns: VoidOrCorrectResult;
      };
      correct_sale: {
        Args: {
          p_sale_id: string;
          p_new_amount: number;
          p_new_quantity: number | null;
          p_new_notes: string | null;
          p_reason: string;
        };
        Returns: VoidOrCorrectResult;
      };
      resolve_approval_request: {
        Args: { p_id: string; p_decision: "approved" | "rejected"; p_notes: string | null };
        Returns: ResolveApprovalResult;
      };
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
