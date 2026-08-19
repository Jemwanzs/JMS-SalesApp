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
export type ImportType = "sales_history" | "products";
export type ImportStatus = "uploaded" | "validating" | "validated" | "importing" | "completed" | "failed";
export type ImportRowStatus = "valid" | "invalid" | "imported" | "skipped";
export type SubscriptionStatus = "TRIAL" | "ACTIVE" | "PAYMENT_DUE" | "GRACE_PERIOD" | "SUSPENDED" | "CANCELLED";
export type BillingInterval = "monthly" | "yearly";
export type PaymentStatus = "success" | "failed" | "pending";

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

export interface ReopenBusinessDayResult {
  status: "reopened" | "pending_approval";
  approvalRequestId?: string;
}

export type TemporaryAccessStatus = "pending" | "approved" | "rejected" | "expired";

export interface RequestTemporaryAccessResult {
  status: "pending_approval";
  approvalRequestId: string;
  requestId: string;
}

export interface BillingSweepResult {
  paymentDue: number;
  gracePeriod: number;
  suspended: number;
  ranAt: string;
}

export interface AutoRelockResult {
  status: BusinessDayStatus;
  relocked: boolean;
}

export type ReportJobStatus = "pending" | "running" | "completed" | "failed";

export interface BusinessDaySweepResult {
  scheduled: number;
  opened: number;
  closed: number;
  relocked: number;
  accessExpired: number;
  ranAt: string;
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
        Insert: Partial<Database["public"]["Tables"]["tenant_settings"]["Row"]> & {
          tenant_id: string;
          setting_key: string;
          value: unknown;
        };
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
      special_hours: {
        Row: {
          id: string;
          tenant_id: string;
          location_id: string;
          date: string;
          is_closed: boolean;
          open_time: string | null;
          close_time: string | null;
          reason: string | null;
        };
        Insert: Partial<Database["public"]["Tables"]["special_hours"]["Row"]> & {
          tenant_id: string;
          location_id: string;
          date: string;
        };
        Update: Partial<Database["public"]["Tables"]["special_hours"]["Row"]>;
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
          show_name_in_photo_view: boolean;
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
      temporary_access_requests: {
        Row: {
          id: string;
          tenant_id: string;
          approval_request_id: string;
          profile_id: string;
          reason: string;
          current_latitude: number | null;
          current_longitude: number | null;
          requested_duration_minutes: number;
          granted_until: string | null;
          status: TemporaryAccessStatus;
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["temporary_access_requests"]["Row"]> & {
          tenant_id: string;
          approval_request_id: string;
          profile_id: string;
          reason: string;
          requested_duration_minutes: number;
        };
        Update: Partial<Database["public"]["Tables"]["temporary_access_requests"]["Row"]>;
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
      report_jobs: {
        Row: {
          id: string;
          tenant_id: string;
          report_id: string | null;
          job_type: string;
          payload: Record<string, unknown>;
          scheduled_for: string;
          status: ReportJobStatus;
          attempts: number;
          last_error: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["report_jobs"]["Row"]> & {
          tenant_id: string;
          job_type: string;
        };
        Update: Partial<Database["public"]["Tables"]["report_jobs"]["Row"]>;
        Relationships: [];
      };
      reports: {
        Row: {
          id: string;
          tenant_id: string;
          location_id: string | null;
          report_type: string;
          period_start: string;
          period_end: string;
          status: "completed" | "failed";
          storage_path: string | null;
          payload: Record<string, unknown>;
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["reports"]["Row"]> & {
          tenant_id: string;
          report_type: string;
          period_start: string;
          period_end: string;
        };
        Update: Partial<Database["public"]["Tables"]["reports"]["Row"]>;
        Relationships: [];
      };
      insights_snapshots: {
        Row: {
          id: string;
          tenant_id: string;
          location_id: string;
          business_day_id: string | null;
          rule_key: string;
          severity: "positive" | "warning" | "info";
          message: string;
          data: Record<string, unknown>;
          generated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["insights_snapshots"]["Row"]> & {
          tenant_id: string;
          location_id: string;
          rule_key: string;
          severity: "positive" | "warning" | "info";
          message: string;
        };
        Update: Partial<Database["public"]["Tables"]["insights_snapshots"]["Row"]>;
        Relationships: [];
      };
      login_events: {
        Row: {
          id: string;
          tenant_id: string | null;
          profile_id: string | null;
          ip: string | null;
          device: string | null;
          browser: string | null;
          os: string | null;
          success: boolean;
          failure_reason: string | null;
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["login_events"]["Row"]> & {
          success: boolean;
        };
        Update: Partial<Database["public"]["Tables"]["login_events"]["Row"]>;
        Relationships: [];
      };
      sessions: {
        Row: {
          id: string;
          profile_id: string;
          tenant_id: string | null;
          device_fingerprint: string | null;
          ip: string | null;
          user_agent: string | null;
          last_seen_at: string;
          revoked_at: string | null;
          revoked_by: string | null;
          revoked_reason: string | null;
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["sessions"]["Row"]> & {
          profile_id: string;
        };
        Update: Partial<Database["public"]["Tables"]["sessions"]["Row"]>;
        Relationships: [];
      };
      audit_logs: {
        Row: {
          id: string;
          tenant_id: string | null;
          actor_profile_id: string | null;
          action: string;
          entity_type: string;
          entity_id: string | null;
          old_values: Record<string, unknown> | null;
          new_values: Record<string, unknown> | null;
          reason: string | null;
          ip: string | null;
          device: string | null;
          metadata: Record<string, unknown> | null;
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["audit_logs"]["Row"]> & {
          action: string;
          entity_type: string;
        };
        Update: Partial<Database["public"]["Tables"]["audit_logs"]["Row"]>;
        Relationships: [];
      };
      download_audit: {
        Row: {
          id: string;
          tenant_id: string;
          profile_id: string;
          export_type: string;
          entity_ref: string | null;
          passcode_verified_at: string | null;
          ip: string | null;
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["download_audit"]["Row"]> & {
          tenant_id: string;
          profile_id: string;
          export_type: string;
        };
        Update: Partial<Database["public"]["Tables"]["download_audit"]["Row"]>;
        Relationships: [];
      };
      imports: {
        Row: {
          id: string;
          tenant_id: string;
          type: ImportType;
          status: ImportStatus;
          file_storage_path: string;
          file_name: string;
          uploaded_by: string;
          confirmed_by: string | null;
          confirmed_at: string | null;
          total_rows: number;
          valid_rows: number;
          error_rows: number;
          imported_rows: number;
          failure_reason: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["imports"]["Row"]> & {
          tenant_id: string;
          type: ImportType;
          file_storage_path: string;
          file_name: string;
          uploaded_by: string;
        };
        Update: Partial<Database["public"]["Tables"]["imports"]["Row"]>;
        Relationships: [];
      };
      import_rows: {
        Row: {
          id: string;
          tenant_id: string;
          import_id: string;
          row_number: number;
          raw_data: Record<string, unknown>;
          status: ImportRowStatus;
          errors: string[] | null;
          resolved_data: Record<string, unknown> | null;
          created_entity_id: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["import_rows"]["Row"]> & {
          tenant_id: string;
          import_id: string;
          row_number: number;
          raw_data: Record<string, unknown>;
        };
        Update: Partial<Database["public"]["Tables"]["import_rows"]["Row"]>;
        Relationships: [];
      };
      billing_plans: {
        Row: {
          id: string;
          code: string;
          name: string;
          price: number;
          currency: string;
          interval: BillingInterval;
          features: unknown;
          is_active: boolean;
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["billing_plans"]["Row"]> & {
          code: string;
          name: string;
          price: number;
          interval: BillingInterval;
        };
        Update: Partial<Database["public"]["Tables"]["billing_plans"]["Row"]>;
        Relationships: [];
      };
      subscriptions: {
        Row: {
          id: string;
          tenant_id: string;
          plan_id: string;
          status: SubscriptionStatus;
          trial_end: string | null;
          current_period_start: string | null;
          current_period_end: string | null;
          next_billing_date: string | null;
          grace_period_end: string | null;
          paystack_customer_code: string | null;
          paystack_subscription_code: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["subscriptions"]["Row"]> & {
          tenant_id: string;
          plan_id: string;
        };
        Update: Partial<Database["public"]["Tables"]["subscriptions"]["Row"]>;
        Relationships: [];
      };
      payments: {
        Row: {
          id: string;
          tenant_id: string;
          subscription_id: string;
          amount: number;
          currency: string;
          status: PaymentStatus;
          paystack_reference: string;
          paid_at: string | null;
          raw_payload: Record<string, unknown> | null;
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["payments"]["Row"]> & {
          tenant_id: string;
          subscription_id: string;
          amount: number;
          currency: string;
          status: PaymentStatus;
          paystack_reference: string;
        };
        Update: Partial<Database["public"]["Tables"]["payments"]["Row"]>;
        Relationships: [];
      };
      billing_events: {
        Row: {
          id: string;
          tenant_id: string | null;
          subscription_id: string | null;
          event_type: string;
          paystack_event_id: string;
          payload: Record<string, unknown>;
          processed_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["billing_events"]["Row"]> & {
          event_type: string;
          paystack_event_id: string;
          payload: Record<string, unknown>;
        };
        Update: Partial<Database["public"]["Tables"]["billing_events"]["Row"]>;
        Relationships: [];
      };
      platform_settings: {
        Row: {
          key: string;
          value: unknown;
          updated_by: string | null;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["platform_settings"]["Row"]> & {
          key: string;
          value: unknown;
        };
        Update: Partial<Database["public"]["Tables"]["platform_settings"]["Row"]>;
        Relationships: [];
      };
      platform_audit_logs: {
        Row: {
          id: string;
          platform_admin_id: string;
          action: string;
          target_tenant_id: string | null;
          target_profile_id: string | null;
          old_values: Record<string, unknown> | null;
          new_values: Record<string, unknown> | null;
          reason: string | null;
          ip: string | null;
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["platform_audit_logs"]["Row"]> & {
          platform_admin_id: string;
          action: string;
        };
        Update: Partial<Database["public"]["Tables"]["platform_audit_logs"]["Row"]>;
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
      reopen_business_day: {
        Args: { p_business_day_id: string; p_reason: string; p_until: string };
        Returns: ReopenBusinessDayResult;
      };
      auto_relock_expired_business_day: {
        Args: { p_business_day_id: string };
        Returns: AutoRelockResult;
      };
      run_business_day_sweep: {
        Args: Record<string, never>;
        Returns: BusinessDaySweepResult;
      };
      run_billing_sweep: {
        Args: Record<string, never>;
        Returns: BillingSweepResult;
      };
      queue_daily_report_job: {
        Args: { p_business_day_id: string };
        Returns: void;
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
      request_temporary_access: {
        Args: {
          p_tenant_id: string;
          p_reason: string;
          p_current_latitude: number | null;
          p_current_longitude: number | null;
          p_duration_minutes: number;
        };
        Returns: RequestTemporaryAccessResult;
      };
    };
  };
}
