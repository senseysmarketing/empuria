export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      activity_feed: {
        Row: {
          actor_id: string | null
          actor_name: string | null
          created_at: string
          description: string | null
          id: string
          payload: Json
          title: string
          type: Database["public"]["Enums"]["activity_type"]
        }
        Insert: {
          actor_id?: string | null
          actor_name?: string | null
          created_at?: string
          description?: string | null
          id?: string
          payload?: Json
          title: string
          type: Database["public"]["Enums"]["activity_type"]
        }
        Update: {
          actor_id?: string | null
          actor_name?: string | null
          created_at?: string
          description?: string | null
          id?: string
          payload?: Json
          title?: string
          type?: Database["public"]["Enums"]["activity_type"]
        }
        Relationships: []
      }
      appointments: {
        Row: {
          created_at: string
          ends_at: string
          id: string
          notes: string | null
          service_id: string
          starts_at: string
          status: Database["public"]["Enums"]["appointment_status"]
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          ends_at: string
          id?: string
          notes?: string | null
          service_id: string
          starts_at: string
          status?: Database["public"]["Enums"]["appointment_status"]
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          ends_at?: string
          id?: string
          notes?: string | null
          service_id?: string
          starts_at?: string
          status?: Database["public"]["Enums"]["appointment_status"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "appointments_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
        ]
      }
      arrivals: {
        Row: {
          arrived_at: string
          created_at: string
          id: string
          lead_id: string | null
          notes: string | null
          purpose: string | null
          registered_by: string | null
          user_id: string | null
          visitor_name: string
        }
        Insert: {
          arrived_at?: string
          created_at?: string
          id?: string
          lead_id?: string | null
          notes?: string | null
          purpose?: string | null
          registered_by?: string | null
          user_id?: string | null
          visitor_name: string
        }
        Update: {
          arrived_at?: string
          created_at?: string
          id?: string
          lead_id?: string | null
          notes?: string | null
          purpose?: string | null
          registered_by?: string | null
          user_id?: string | null
          visitor_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "arrivals_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      automation_triggers: {
        Row: {
          channel: Database["public"]["Enums"]["automation_channel"]
          created_at: string
          description: string | null
          id: string
          is_enabled: boolean
          key: string
          name: string
          template: string
          updated_at: string
          variables: Json
        }
        Insert: {
          channel?: Database["public"]["Enums"]["automation_channel"]
          created_at?: string
          description?: string | null
          id?: string
          is_enabled?: boolean
          key: string
          name: string
          template?: string
          updated_at?: string
          variables?: Json
        }
        Update: {
          channel?: Database["public"]["Enums"]["automation_channel"]
          created_at?: string
          description?: string | null
          id?: string
          is_enabled?: boolean
          key?: string
          name?: string
          template?: string
          updated_at?: string
          variables?: Json
        }
        Relationships: []
      }
      availability_slots: {
        Row: {
          booked: number
          capacity: number
          created_at: string
          ends_at: string
          id: string
          is_active: boolean
          notes: string | null
          service_id: string
          starts_at: string
          updated_at: string
        }
        Insert: {
          booked?: number
          capacity?: number
          created_at?: string
          ends_at: string
          id?: string
          is_active?: boolean
          notes?: string | null
          service_id: string
          starts_at: string
          updated_at?: string
        }
        Update: {
          booked?: number
          capacity?: number
          created_at?: string
          ends_at?: string
          id?: string
          is_active?: boolean
          notes?: string | null
          service_id?: string
          starts_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "availability_slots_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
        ]
      }
      club_content: {
        Row: {
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          is_published: boolean
          module: string
          position: number
          thumbnail_url: string | null
          title: string
          updated_at: string
          video_url: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_published?: boolean
          module?: string
          position?: number
          thumbnail_url?: string | null
          title: string
          updated_at?: string
          video_url?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_published?: boolean
          module?: string
          position?: number
          thumbnail_url?: string | null
          title?: string
          updated_at?: string
          video_url?: string | null
        }
        Relationships: []
      }
      community_posts: {
        Row: {
          author_id: string | null
          author_name: string | null
          body: string
          created_at: string
          id: string
          is_pinned: boolean
          updated_at: string
        }
        Insert: {
          author_id?: string | null
          author_name?: string | null
          body: string
          created_at?: string
          id?: string
          is_pinned?: boolean
          updated_at?: string
        }
        Update: {
          author_id?: string | null
          author_name?: string | null
          body?: string
          created_at?: string
          id?: string
          is_pinned?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      leads: {
        Row: {
          budget_range: string | null
          created_at: string
          current_country: string | null
          email: string
          full_name: string
          id: string
          message: string | null
          notes: string | null
          phone: string
          pipeline_stage: Database["public"]["Enums"]["lead_pipeline_stage"]
          qualification_answers: Json
          qualification_score: number | null
          status: Database["public"]["Enums"]["lead_status"]
          target_visa: string | null
          timeline: string | null
          updated_at: string
          user_id: string | null
        }
        Insert: {
          budget_range?: string | null
          created_at?: string
          current_country?: string | null
          email: string
          full_name: string
          id?: string
          message?: string | null
          notes?: string | null
          phone: string
          pipeline_stage?: Database["public"]["Enums"]["lead_pipeline_stage"]
          qualification_answers?: Json
          qualification_score?: number | null
          status?: Database["public"]["Enums"]["lead_status"]
          target_visa?: string | null
          timeline?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          budget_range?: string | null
          created_at?: string
          current_country?: string | null
          email?: string
          full_name?: string
          id?: string
          message?: string | null
          notes?: string | null
          phone?: string
          pipeline_stage?: Database["public"]["Enums"]["lead_pipeline_stage"]
          qualification_answers?: Json
          qualification_score?: number | null
          status?: Database["public"]["Enums"]["lead_status"]
          target_visa?: string | null
          timeline?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Relationships: []
      }
      order_documents: {
        Row: {
          checked: boolean
          created_at: string
          id: string
          label: string
          order_id: string
          position: number
          updated_at: string
        }
        Insert: {
          checked?: boolean
          created_at?: string
          id?: string
          label: string
          order_id: string
          position?: number
          updated_at?: string
        }
        Update: {
          checked?: boolean
          created_at?: string
          id?: string
          label?: string
          order_id?: string
          position?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "order_documents_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          amount_cents: number
          assigned_staff_id: string | null
          created_at: string
          currency: string
          customer_email: string | null
          customer_name: string
          delivery_status: Database["public"]["Enums"]["order_delivery_status"]
          executed_at: string | null
          host_profile_id: string | null
          id: string
          notes: string | null
          payment_status: Database["public"]["Enums"]["order_payment_status"]
          service_id: string | null
          service_metadata: Json
          service_title: string
          slot_id: string | null
          updated_at: string
          user_id: string | null
          voucher_code: string | null
        }
        Insert: {
          amount_cents?: number
          assigned_staff_id?: string | null
          created_at?: string
          currency?: string
          customer_email?: string | null
          customer_name: string
          delivery_status?: Database["public"]["Enums"]["order_delivery_status"]
          executed_at?: string | null
          host_profile_id?: string | null
          id?: string
          notes?: string | null
          payment_status?: Database["public"]["Enums"]["order_payment_status"]
          service_id?: string | null
          service_metadata?: Json
          service_title: string
          slot_id?: string | null
          updated_at?: string
          user_id?: string | null
          voucher_code?: string | null
        }
        Update: {
          amount_cents?: number
          assigned_staff_id?: string | null
          created_at?: string
          currency?: string
          customer_email?: string | null
          customer_name?: string
          delivery_status?: Database["public"]["Enums"]["order_delivery_status"]
          executed_at?: string | null
          host_profile_id?: string | null
          id?: string
          notes?: string | null
          payment_status?: Database["public"]["Enums"]["order_payment_status"]
          service_id?: string | null
          service_metadata?: Json
          service_title?: string
          slot_id?: string | null
          updated_at?: string
          user_id?: string | null
          voucher_code?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "orders_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          country_origin: string | null
          created_at: string
          full_name: string | null
          id: string
          is_club_member: boolean
          phone: string | null
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          country_origin?: string | null
          created_at?: string
          full_name?: string | null
          id: string
          is_club_member?: boolean
          phone?: string | null
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          country_origin?: string | null
          created_at?: string
          full_name?: string | null
          id?: string
          is_club_member?: boolean
          phone?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      services: {
        Row: {
          category: Database["public"]["Enums"]["service_category"]
          created_at: string
          currency: string
          description: string | null
          document_checklist: Json
          duration_minutes: number | null
          id: string
          image_url: string | null
          is_active: boolean
          kind: Database["public"]["Enums"]["service_kind"] | null
          meeting_address: string | null
          price_cents: number
          requires_booking: boolean
          requires_documents: boolean
          requires_slot: boolean
          short_description: string | null
          slug: string
          title: string
          updated_at: string
        }
        Insert: {
          category: Database["public"]["Enums"]["service_category"]
          created_at?: string
          currency?: string
          description?: string | null
          document_checklist?: Json
          duration_minutes?: number | null
          id?: string
          image_url?: string | null
          is_active?: boolean
          kind?: Database["public"]["Enums"]["service_kind"] | null
          meeting_address?: string | null
          price_cents?: number
          requires_booking?: boolean
          requires_documents?: boolean
          requires_slot?: boolean
          short_description?: string | null
          slug: string
          title: string
          updated_at?: string
        }
        Update: {
          category?: Database["public"]["Enums"]["service_category"]
          created_at?: string
          currency?: string
          description?: string | null
          document_checklist?: Json
          duration_minutes?: number | null
          id?: string
          image_url?: string | null
          is_active?: boolean
          kind?: Database["public"]["Enums"]["service_kind"] | null
          meeting_address?: string | null
          price_cents?: number
          requires_booking?: boolean
          requires_documents?: boolean
          requires_slot?: boolean
          short_description?: string | null
          slug?: string
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      staff_assignments: {
        Row: {
          appointment_id: string
          created_at: string
          id: string
          role: string | null
          staff_id: string
        }
        Insert: {
          appointment_id: string
          created_at?: string
          id?: string
          role?: string | null
          staff_id: string
        }
        Update: {
          appointment_id?: string
          created_at?: string
          id?: string
          role?: string | null
          staff_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "staff_assignments_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_staff: { Args: { _user_id: string }; Returns: boolean }
    }
    Enums: {
      activity_type:
        | "order_created"
        | "order_paid"
        | "lead_created"
        | "lead_qualified"
        | "lead_dismissed"
        | "member_joined"
        | "appointment_created"
        | "arrival_registered"
        | "content_published"
        | "post_created"
      app_role: "admin" | "staff" | "member"
      appointment_status: "pendente" | "confirmado" | "cancelado" | "concluido"
      automation_channel: "whatsapp" | "email" | "painel"
      lead_pipeline_stage: "novo" | "analise" | "qualificado" | "descartado"
      lead_status: "novo" | "contatado" | "qualificado" | "fechado" | "perdido"
      order_delivery_status:
        | "aguardando_pagamento"
        | "aguardando_documentos"
        | "processando"
        | "agendado"
        | "concluido"
      order_payment_status: "pendente" | "aprovado" | "recusado" | "estornado"
      service_category: "esteira1" | "esteira2" | "clube"
      service_kind: "airport" | "tour" | "consulting" | "banking" | "meeting"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      activity_type: [
        "order_created",
        "order_paid",
        "lead_created",
        "lead_qualified",
        "lead_dismissed",
        "member_joined",
        "appointment_created",
        "arrival_registered",
        "content_published",
        "post_created",
      ],
      app_role: ["admin", "staff", "member"],
      appointment_status: ["pendente", "confirmado", "cancelado", "concluido"],
      automation_channel: ["whatsapp", "email", "painel"],
      lead_pipeline_stage: ["novo", "analise", "qualificado", "descartado"],
      lead_status: ["novo", "contatado", "qualificado", "fechado", "perdido"],
      order_delivery_status: [
        "aguardando_pagamento",
        "aguardando_documentos",
        "processando",
        "agendado",
        "concluido",
      ],
      order_payment_status: ["pendente", "aprovado", "recusado", "estornado"],
      service_category: ["esteira1", "esteira2", "clube"],
      service_kind: ["airport", "tour", "consulting", "banking", "meeting"],
    },
  },
} as const
