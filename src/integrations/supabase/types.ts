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
      audit_logs: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          entity_id: string | null
          entity_type: string | null
          id: string
          metadata: Json
          module: string
          new_data: Json | null
          old_data: Json | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          metadata?: Json
          module: string
          new_data?: Json | null
          old_data?: Json | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          metadata?: Json
          module?: string
          new_data?: Json | null
          old_data?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_logs_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
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
      calendar_tasks: {
        Row: {
          appointment_id: string | null
          assignee_id: string | null
          completed_at: string | null
          created_at: string
          created_by: string | null
          description: string | null
          due_at: string | null
          event_id: string | null
          id: string
          lead_id: string | null
          priority: Database["public"]["Enums"]["calendar_task_priority"]
          status: Database["public"]["Enums"]["calendar_task_status"]
          tags: string[]
          title: string
          updated_at: string
        }
        Insert: {
          appointment_id?: string | null
          assignee_id?: string | null
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          due_at?: string | null
          event_id?: string | null
          id?: string
          lead_id?: string | null
          priority?: Database["public"]["Enums"]["calendar_task_priority"]
          status?: Database["public"]["Enums"]["calendar_task_status"]
          tags?: string[]
          title: string
          updated_at?: string
        }
        Update: {
          appointment_id?: string | null
          assignee_id?: string | null
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          due_at?: string | null
          event_id?: string | null
          id?: string
          lead_id?: string | null
          priority?: Database["public"]["Enums"]["calendar_task_priority"]
          status?: Database["public"]["Enums"]["calendar_task_status"]
          tags?: string[]
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      client_error_logs: {
        Row: {
          app_version: string | null
          created_at: string
          extra: Json | null
          id: string
          message: string
          scope: string
          stack: string | null
          url: string | null
          user_agent: string | null
          user_id: string | null
          user_label: string | null
        }
        Insert: {
          app_version?: string | null
          created_at?: string
          extra?: Json | null
          id?: string
          message: string
          scope: string
          stack?: string | null
          url?: string | null
          user_agent?: string | null
          user_id?: string | null
          user_label?: string | null
        }
        Update: {
          app_version?: string | null
          created_at?: string
          extra?: Json | null
          id?: string
          message?: string
          scope?: string
          stack?: string | null
          url?: string | null
          user_agent?: string | null
          user_id?: string | null
          user_label?: string | null
        }
        Relationships: []
      }
      crm_automation_execution_logs: {
        Row: {
          created_at: string
          event_type: string
          execution_id: string | null
          flow_id: string | null
          id: string
          lead_id: string | null
          message: string | null
          metadata: Json
          step_id: string | null
        }
        Insert: {
          created_at?: string
          event_type: string
          execution_id?: string | null
          flow_id?: string | null
          id?: string
          lead_id?: string | null
          message?: string | null
          metadata?: Json
          step_id?: string | null
        }
        Update: {
          created_at?: string
          event_type?: string
          execution_id?: string | null
          flow_id?: string | null
          id?: string
          lead_id?: string | null
          message?: string | null
          metadata?: Json
          step_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "crm_automation_execution_logs_execution_id_fkey"
            columns: ["execution_id"]
            isOneToOne: false
            referencedRelation: "crm_automation_executions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_automation_execution_logs_flow_id_fkey"
            columns: ["flow_id"]
            isOneToOne: false
            referencedRelation: "crm_automation_flows"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_automation_execution_logs_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_automation_execution_logs_step_id_fkey"
            columns: ["step_id"]
            isOneToOne: false
            referencedRelation: "crm_automation_steps"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_automation_executions: {
        Row: {
          completed_at: string | null
          conversation_id: string | null
          created_at: string
          current_step_id: string | null
          flow_id: string
          id: string
          last_activity_at: string
          last_error: string | null
          lead_id: string
          started_at: string
          status: string
          stop_reason: string | null
          trigger_payload: Json
          trigger_type: string
          updated_at: string
        }
        Insert: {
          completed_at?: string | null
          conversation_id?: string | null
          created_at?: string
          current_step_id?: string | null
          flow_id: string
          id?: string
          last_activity_at?: string
          last_error?: string | null
          lead_id: string
          started_at?: string
          status?: string
          stop_reason?: string | null
          trigger_payload?: Json
          trigger_type?: string
          updated_at?: string
        }
        Update: {
          completed_at?: string | null
          conversation_id?: string | null
          created_at?: string
          current_step_id?: string | null
          flow_id?: string
          id?: string
          last_activity_at?: string
          last_error?: string | null
          lead_id?: string
          started_at?: string
          status?: string
          stop_reason?: string | null
          trigger_payload?: Json
          trigger_type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_automation_executions_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "crm_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_automation_executions_current_step_id_fkey"
            columns: ["current_step_id"]
            isOneToOne: false
            referencedRelation: "crm_automation_steps"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_automation_executions_flow_id_fkey"
            columns: ["flow_id"]
            isOneToOne: false
            referencedRelation: "crm_automation_flows"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_automation_executions_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_automation_flows: {
        Row: {
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          is_deleted: boolean
          metrics: Json
          name: string
          schedule_window: Json
          status: string
          stop_rules: Json
          trigger_config: Json
          trigger_type: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_deleted?: boolean
          metrics?: Json
          name: string
          schedule_window?: Json
          status?: string
          stop_rules?: Json
          trigger_config?: Json
          trigger_type?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_deleted?: boolean
          metrics?: Json
          name?: string
          schedule_window?: Json
          status?: string
          stop_rules?: Json
          trigger_config?: Json
          trigger_type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_automation_flows_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_automation_pending_actions: {
        Row: {
          action_type: string
          attempts: number
          created_at: string
          execution_id: string
          flow_id: string
          id: string
          idempotency_key: string
          last_error: string | null
          lead_id: string
          locked_at: string | null
          payload: Json
          run_at: string
          status: string
          step_id: string
          updated_at: string
        }
        Insert: {
          action_type?: string
          attempts?: number
          created_at?: string
          execution_id: string
          flow_id: string
          id?: string
          idempotency_key: string
          last_error?: string | null
          lead_id: string
          locked_at?: string | null
          payload?: Json
          run_at?: string
          status?: string
          step_id: string
          updated_at?: string
        }
        Update: {
          action_type?: string
          attempts?: number
          created_at?: string
          execution_id?: string
          flow_id?: string
          id?: string
          idempotency_key?: string
          last_error?: string | null
          lead_id?: string
          locked_at?: string | null
          payload?: Json
          run_at?: string
          status?: string
          step_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_automation_pending_actions_execution_id_fkey"
            columns: ["execution_id"]
            isOneToOne: false
            referencedRelation: "crm_automation_executions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_automation_pending_actions_flow_id_fkey"
            columns: ["flow_id"]
            isOneToOne: false
            referencedRelation: "crm_automation_flows"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_automation_pending_actions_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_automation_pending_actions_step_id_fkey"
            columns: ["step_id"]
            isOneToOne: false
            referencedRelation: "crm_automation_steps"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_automation_steps: {
        Row: {
          config: Json
          created_at: string
          flow_id: string
          id: string
          is_deleted: boolean
          next_step_id: string | null
          position: number
          step_type: string
          title: string
          updated_at: string
        }
        Insert: {
          config?: Json
          created_at?: string
          flow_id: string
          id?: string
          is_deleted?: boolean
          next_step_id?: string | null
          position?: number
          step_type: string
          title: string
          updated_at?: string
        }
        Update: {
          config?: Json
          created_at?: string
          flow_id?: string
          id?: string
          is_deleted?: boolean
          next_step_id?: string | null
          position?: number
          step_type?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_automation_steps_flow_id_fkey"
            columns: ["flow_id"]
            isOneToOne: false
            referencedRelation: "crm_automation_flows"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_automation_steps_next_step_id_fkey"
            columns: ["next_step_id"]
            isOneToOne: false
            referencedRelation: "crm_automation_steps"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_columns: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          is_active: boolean
          is_locked: boolean
          key: string
          label: string
          position: number
          type: Database["public"]["Enums"]["crm_column_type"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          is_locked?: boolean
          key: string
          label: string
          position?: number
          type?: Database["public"]["Enums"]["crm_column_type"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          is_locked?: boolean
          key?: string
          label?: string
          position?: number
          type?: Database["public"]["Enums"]["crm_column_type"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_columns_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_conversations: {
        Row: {
          created_at: string
          id: string
          last_inbound_at: string | null
          last_message_at: string | null
          last_outbound_at: string | null
          lead_id: string
          phone: string
          provider: string
          provider_chat_id: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          last_inbound_at?: string | null
          last_message_at?: string | null
          last_outbound_at?: string | null
          lead_id: string
          phone: string
          provider?: string
          provider_chat_id?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          last_inbound_at?: string | null
          last_message_at?: string | null
          last_outbound_at?: string | null
          lead_id?: string
          phone?: string
          provider?: string
          provider_chat_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_conversations_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_distribution_members: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          position: number
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          position?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          position?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_distribution_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_distribution_settings: {
        Row: {
          created_at: string
          fixed_user_id: string | null
          id: string
          is_active: boolean
          last_assigned_user_id: string | null
          mode: Database["public"]["Enums"]["crm_distribution_mode"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          fixed_user_id?: string | null
          id?: string
          is_active?: boolean
          last_assigned_user_id?: string | null
          mode?: Database["public"]["Enums"]["crm_distribution_mode"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          fixed_user_id?: string | null
          id?: string
          is_active?: boolean
          last_assigned_user_id?: string | null
          mode?: Database["public"]["Enums"]["crm_distribution_mode"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_distribution_settings_fixed_user_id_fkey"
            columns: ["fixed_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_distribution_settings_last_assigned_user_id_fkey"
            columns: ["last_assigned_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_followups: {
        Row: {
          assigned_to: string
          canceled_reason: string | null
          completed_at: string | null
          created_at: string
          created_by: string | null
          due_at: string
          id: string
          lead_id: string
          message_preview: string | null
          mode: Database["public"]["Enums"]["crm_followup_mode"]
          sent_at: string | null
          sent_message_id: string | null
          sequence_key: string | null
          status: Database["public"]["Enums"]["crm_followup_status"]
          step_index: number | null
          template_key: string | null
          type: string
          updated_at: string
        }
        Insert: {
          assigned_to: string
          canceled_reason?: string | null
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          due_at: string
          id?: string
          lead_id: string
          message_preview?: string | null
          mode?: Database["public"]["Enums"]["crm_followup_mode"]
          sent_at?: string | null
          sent_message_id?: string | null
          sequence_key?: string | null
          status?: Database["public"]["Enums"]["crm_followup_status"]
          step_index?: number | null
          template_key?: string | null
          type?: string
          updated_at?: string
        }
        Update: {
          assigned_to?: string
          canceled_reason?: string | null
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          due_at?: string
          id?: string
          lead_id?: string
          message_preview?: string | null
          mode?: Database["public"]["Enums"]["crm_followup_mode"]
          sent_at?: string | null
          sent_message_id?: string | null
          sequence_key?: string | null
          status?: Database["public"]["Enums"]["crm_followup_status"]
          step_index?: number | null
          template_key?: string | null
          type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_followups_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_followups_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_followups_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_followups_sent_message_id_fkey"
            columns: ["sent_message_id"]
            isOneToOne: false
            referencedRelation: "crm_messages"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_inbox_messages: {
        Row: {
          body: string | null
          created_at: string
          from_name: string | null
          from_phone: string
          id: string
          matched_lead_id: string | null
          message_type: string
          provider: string
          provider_chat_id: string | null
          provider_message_id: string | null
          raw_payload: Json
          status: Database["public"]["Enums"]["crm_inbox_status"]
        }
        Insert: {
          body?: string | null
          created_at?: string
          from_name?: string | null
          from_phone: string
          id?: string
          matched_lead_id?: string | null
          message_type?: string
          provider?: string
          provider_chat_id?: string | null
          provider_message_id?: string | null
          raw_payload?: Json
          status?: Database["public"]["Enums"]["crm_inbox_status"]
        }
        Update: {
          body?: string | null
          created_at?: string
          from_name?: string | null
          from_phone?: string
          id?: string
          matched_lead_id?: string | null
          message_type?: string
          provider?: string
          provider_chat_id?: string | null
          provider_message_id?: string | null
          raw_payload?: Json
          status?: Database["public"]["Enums"]["crm_inbox_status"]
        }
        Relationships: [
          {
            foreignKeyName: "crm_inbox_messages_matched_lead_id_fkey"
            columns: ["matched_lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_messages: {
        Row: {
          body: string | null
          conversation_id: string | null
          created_at: string
          direction: Database["public"]["Enums"]["crm_message_direction"]
          id: string
          lead_id: string
          message_type: string
          provider: string
          provider_message_id: string | null
          sent_by: string | null
          status: string | null
        }
        Insert: {
          body?: string | null
          conversation_id?: string | null
          created_at?: string
          direction: Database["public"]["Enums"]["crm_message_direction"]
          id?: string
          lead_id: string
          message_type?: string
          provider?: string
          provider_message_id?: string | null
          sent_by?: string | null
          status?: string | null
        }
        Update: {
          body?: string | null
          conversation_id?: string | null
          created_at?: string
          direction?: Database["public"]["Enums"]["crm_message_direction"]
          id?: string
          lead_id?: string
          message_type?: string
          provider?: string
          provider_message_id?: string | null
          sent_by?: string | null
          status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "crm_messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "crm_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_messages_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_messages_sent_by_fkey"
            columns: ["sent_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      event_ticket_tiers: {
        Row: {
          benefits: Json
          capacity: number | null
          created_at: string
          event_id: string
          id: string
          is_active: boolean
          name: string
          position: number
          price_cents: number
          sold: number
          updated_at: string
        }
        Insert: {
          benefits?: Json
          capacity?: number | null
          created_at?: string
          event_id: string
          id?: string
          is_active?: boolean
          name: string
          position?: number
          price_cents?: number
          sold?: number
          updated_at?: string
        }
        Update: {
          benefits?: Json
          capacity?: number | null
          created_at?: string
          event_id?: string
          id?: string
          is_active?: boolean
          name?: string
          position?: number
          price_cents?: number
          sold?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_ticket_tiers_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      event_tickets: {
        Row: {
          checked_in_at: string | null
          checked_in_by: string | null
          code: string
          created_at: string
          event_id: string
          id: string
          notes: string | null
          order_id: string | null
          status: Database["public"]["Enums"]["event_ticket_status"]
          tier_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          checked_in_at?: string | null
          checked_in_by?: string | null
          code: string
          created_at?: string
          event_id: string
          id?: string
          notes?: string | null
          order_id?: string | null
          status?: Database["public"]["Enums"]["event_ticket_status"]
          tier_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          checked_in_at?: string | null
          checked_in_by?: string | null
          code?: string
          created_at?: string
          event_id?: string
          id?: string
          notes?: string | null
          order_id?: string | null
          status?: Database["public"]["Enums"]["event_ticket_status"]
          tier_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_tickets_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_tickets_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_tickets_tier_id_fkey"
            columns: ["tier_id"]
            isOneToOne: false
            referencedRelation: "event_ticket_tiers"
            referencedColumns: ["id"]
          },
        ]
      }
      events: {
        Row: {
          cover_kind: string
          cover_url: string | null
          cover_url_vertical: string | null
          created_at: string
          created_by: string | null
          description: string | null
          ends_at: string | null
          id: string
          is_home_featured: boolean
          is_published: boolean
          location_address: string | null
          location_lat: number | null
          location_lng: number | null
          sales_mode: Database["public"]["Enums"]["event_sales_mode"]
          slug: string
          starts_at: string
          title: string
          updated_at: string
        }
        Insert: {
          cover_kind?: string
          cover_url?: string | null
          cover_url_vertical?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          ends_at?: string | null
          id?: string
          is_home_featured?: boolean
          is_published?: boolean
          location_address?: string | null
          location_lat?: number | null
          location_lng?: number | null
          sales_mode?: Database["public"]["Enums"]["event_sales_mode"]
          slug: string
          starts_at: string
          title: string
          updated_at?: string
        }
        Update: {
          cover_kind?: string
          cover_url?: string | null
          cover_url_vertical?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          ends_at?: string | null
          id?: string
          is_home_featured?: boolean
          is_published?: boolean
          location_address?: string | null
          location_lat?: number | null
          location_lng?: number | null
          sales_mode?: Database["public"]["Enums"]["event_sales_mode"]
          slug?: string
          starts_at?: string
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      finance_accounts: {
        Row: {
          created_at: string
          currency: string
          id: string
          is_active: boolean
          name: string
          normalized_name: string
          type: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          currency?: string
          id?: string
          is_active?: boolean
          name: string
          normalized_name: string
          type?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          currency?: string
          id?: string
          is_active?: boolean
          name?: string
          normalized_name?: string
          type?: string
          updated_at?: string
        }
        Relationships: []
      }
      finance_categories: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          is_system: boolean
          name: string
          type: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          is_system?: boolean
          name: string
          type: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          is_system?: boolean
          name?: string
          type?: string
          updated_at?: string
        }
        Relationships: []
      }
      finance_month_closures: {
        Row: {
          closed_at: string | null
          closed_by: string | null
          created_at: string
          final_snapshot: Json | null
          id: string
          period_month: string
          prepared_at: string | null
          prepared_by: string | null
          preview_snapshot: Json | null
          status: string
          updated_at: string
        }
        Insert: {
          closed_at?: string | null
          closed_by?: string | null
          created_at?: string
          final_snapshot?: Json | null
          id?: string
          period_month: string
          prepared_at?: string | null
          prepared_by?: string | null
          preview_snapshot?: Json | null
          status: string
          updated_at?: string
        }
        Update: {
          closed_at?: string | null
          closed_by?: string | null
          created_at?: string
          final_snapshot?: Json | null
          id?: string
          period_month?: string
          prepared_at?: string | null
          prepared_by?: string | null
          preview_snapshot?: Json | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "finance_month_closures_closed_by_fkey"
            columns: ["closed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_month_closures_prepared_by_fkey"
            columns: ["prepared_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      finance_month_distributions: {
        Row: {
          amount_cents: number
          closure_id: string
          created_at: string
          currency: string
          finance_transaction_id: string | null
          id: string
          partner_code: string
          partner_name: string
          percentage: number
        }
        Insert: {
          amount_cents: number
          closure_id: string
          created_at?: string
          currency: string
          finance_transaction_id?: string | null
          id?: string
          partner_code: string
          partner_name: string
          percentage: number
        }
        Update: {
          amount_cents?: number
          closure_id?: string
          created_at?: string
          currency?: string
          finance_transaction_id?: string | null
          id?: string
          partner_code?: string
          partner_name?: string
          percentage?: number
        }
        Relationships: [
          {
            foreignKeyName: "finance_month_distributions_closure_id_fkey"
            columns: ["closure_id"]
            isOneToOne: false
            referencedRelation: "finance_month_closures"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_month_distributions_finance_transaction_id_fkey"
            columns: ["finance_transaction_id"]
            isOneToOne: true
            referencedRelation: "finance_transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      finance_payees: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          is_active: boolean
          name: string
          notes: string | null
          profile_id: string | null
          type: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          name: string
          notes?: string | null
          profile_id?: string | null
          type: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          name?: string
          notes?: string | null
          profile_id?: string | null
          type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "finance_payees_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_payees_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      finance_payout_rules: {
        Row: {
          amount_cents: number | null
          created_at: string
          created_by: string | null
          currency: string | null
          day_of_month: number | null
          ends_on: string | null
          id: string
          is_active: boolean
          payee_id: string
          percentage: number | null
          rule_type: string
          service_id: string | null
          starts_on: string
          updated_at: string
        }
        Insert: {
          amount_cents?: number | null
          created_at?: string
          created_by?: string | null
          currency?: string | null
          day_of_month?: number | null
          ends_on?: string | null
          id?: string
          is_active?: boolean
          payee_id: string
          percentage?: number | null
          rule_type: string
          service_id?: string | null
          starts_on: string
          updated_at?: string
        }
        Update: {
          amount_cents?: number | null
          created_at?: string
          created_by?: string | null
          currency?: string | null
          day_of_month?: number | null
          ends_on?: string | null
          id?: string
          is_active?: boolean
          payee_id?: string
          percentage?: number | null
          rule_type?: string
          service_id?: string | null
          starts_on?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "finance_payout_rules_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_payout_rules_payee_id_fkey"
            columns: ["payee_id"]
            isOneToOne: false
            referencedRelation: "finance_payees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_payout_rules_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
        ]
      }
      finance_payouts: {
        Row: {
          amount_cents: number
          base_amount_cents: number
          created_at: string
          created_by: string | null
          currency: string
          finance_transaction_id: string | null
          generated_at: string
          id: string
          payee_id: string
          percentage: number | null
          period_month: string
          rule_id: string
        }
        Insert: {
          amount_cents: number
          base_amount_cents: number
          created_at?: string
          created_by?: string | null
          currency: string
          finance_transaction_id?: string | null
          generated_at?: string
          id?: string
          payee_id: string
          percentage?: number | null
          period_month: string
          rule_id: string
        }
        Update: {
          amount_cents?: number
          base_amount_cents?: number
          created_at?: string
          created_by?: string | null
          currency?: string
          finance_transaction_id?: string | null
          generated_at?: string
          id?: string
          payee_id?: string
          percentage?: number | null
          period_month?: string
          rule_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "finance_payouts_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_payouts_finance_transaction_id_fkey"
            columns: ["finance_transaction_id"]
            isOneToOne: true
            referencedRelation: "finance_transactions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_payouts_payee_id_fkey"
            columns: ["payee_id"]
            isOneToOne: false
            referencedRelation: "finance_payees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_payouts_rule_id_fkey"
            columns: ["rule_id"]
            isOneToOne: false
            referencedRelation: "finance_payout_rules"
            referencedColumns: ["id"]
          },
        ]
      }
      finance_recurring_rules: {
        Row: {
          account_id: string | null
          amount_brl_cents: number | null
          amount_cents: number
          category_id: string | null
          created_at: string
          created_by: string | null
          currency: string
          day_of_month: number
          description: string
          ends_on: string | null
          frequency: string
          id: string
          is_active: boolean
          next_run_at: string | null
          starts_on: string
          type: string
          updated_at: string
        }
        Insert: {
          account_id?: string | null
          amount_brl_cents?: number | null
          amount_cents?: number
          category_id?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          day_of_month?: number
          description: string
          ends_on?: string | null
          frequency?: string
          id?: string
          is_active?: boolean
          next_run_at?: string | null
          starts_on?: string
          type: string
          updated_at?: string
        }
        Update: {
          account_id?: string | null
          amount_brl_cents?: number | null
          amount_cents?: number
          category_id?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          day_of_month?: number
          description?: string
          ends_on?: string | null
          frequency?: string
          id?: string
          is_active?: boolean
          next_run_at?: string | null
          starts_on?: string
          type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "finance_recurring_rules_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "finance_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_recurring_rules_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "finance_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_recurring_rules_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      finance_transactions: {
        Row: {
          account_id: string | null
          adjustment_for_month: string | null
          amount_brl_cents: number | null
          amount_cents: number
          category_id: string | null
          created_at: string
          created_by: string | null
          currency: string
          description: string
          due_date: string
          fx_date: string | null
          fx_rate: number | null
          fx_reference_rate: number | null
          fx_source: string | null
          id: string
          is_automatic: boolean
          notes: string | null
          paid_at: string | null
          payment_method: string | null
          reference_amount_cents: number | null
          reference_currency: string | null
          settled_amount_cents: number | null
          settled_currency: string | null
          source_id: string | null
          source_module: string
          status: string
          type: string
          updated_at: string
        }
        Insert: {
          account_id?: string | null
          adjustment_for_month?: string | null
          amount_brl_cents?: number | null
          amount_cents?: number
          category_id?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          description: string
          due_date?: string
          fx_date?: string | null
          fx_rate?: number | null
          fx_reference_rate?: number | null
          fx_source?: string | null
          id?: string
          is_automatic?: boolean
          notes?: string | null
          paid_at?: string | null
          payment_method?: string | null
          reference_amount_cents?: number | null
          reference_currency?: string | null
          settled_amount_cents?: number | null
          settled_currency?: string | null
          source_id?: string | null
          source_module?: string
          status?: string
          type: string
          updated_at?: string
        }
        Update: {
          account_id?: string | null
          adjustment_for_month?: string | null
          amount_brl_cents?: number | null
          amount_cents?: number
          category_id?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          description?: string
          due_date?: string
          fx_date?: string | null
          fx_rate?: number | null
          fx_reference_rate?: number | null
          fx_source?: string | null
          id?: string
          is_automatic?: boolean
          notes?: string | null
          paid_at?: string | null
          payment_method?: string | null
          reference_amount_cents?: number | null
          reference_currency?: string | null
          settled_amount_cents?: number | null
          settled_currency?: string | null
          source_id?: string | null
          source_module?: string
          status?: string
          type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "finance_transactions_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "finance_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_transactions_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "finance_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_transactions_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      impersonation_logs: {
        Row: {
          admin_id: string
          created_at: string
          id: string
          reason: string
          target_user_id: string
        }
        Insert: {
          admin_id: string
          created_at?: string
          id?: string
          reason: string
          target_user_id: string
        }
        Update: {
          admin_id?: string
          created_at?: string
          id?: string
          reason?: string
          target_user_id?: string
        }
        Relationships: []
      }
      integration_events: {
        Row: {
          buyer_email: string | null
          created_at: string
          error_message: string | null
          event_type: string
          id: string
          payload: Json
          processed_at: string | null
          provider: string
          provider_event_id: string | null
          status: string
        }
        Insert: {
          buyer_email?: string | null
          created_at?: string
          error_message?: string | null
          event_type: string
          id?: string
          payload?: Json
          processed_at?: string | null
          provider?: string
          provider_event_id?: string | null
          status?: string
        }
        Update: {
          buyer_email?: string | null
          created_at?: string
          error_message?: string | null
          event_type?: string
          id?: string
          payload?: Json
          processed_at?: string | null
          provider?: string
          provider_event_id?: string | null
          status?: string
        }
        Relationships: []
      }
      integration_settings: {
        Row: {
          access_token: string | null
          boleto_enabled: boolean
          boleto_expiration_days: number
          card_enabled: boolean
          checkout_url: string | null
          created_at: string
          default_currency: string
          environment: string
          id: string
          is_enabled: boolean
          last_event_at: string | null
          offer_id: string | null
          pix_enabled: boolean
          pix_expiration_minutes: number
          post_purchase_url: string | null
          prod_access_token: string | null
          prod_public_key: string | null
          prod_webhook_secret: string | null
          product_id: string | null
          provider: string
          public_key: string | null
          statement_descriptor: string
          test_access_token: string | null
          test_public_key: string | null
          test_webhook_secret: string | null
          updated_at: string
          webhook_secret: string | null
          whatsapp_group_url: string | null
          wise_api_token: string | null
          wise_balance_currency: string | null
          wise_balance_id_eur: string | null
          wise_bank_address: string | null
          wise_beneficiary_address: string | null
          wise_beneficiary_name: string | null
          wise_bic: string | null
          wise_confirmation_mode: string | null
          wise_default_payment_url: string | null
          wise_environment: string | null
          wise_iban: string | null
          wise_last_event_at: string | null
          wise_profile_id: string | null
          wise_profile_name: string | null
          wise_profile_type: string | null
          wise_webhook_public_key: string | null
          wise_webhook_subscriptions: Json
        }
        Insert: {
          access_token?: string | null
          boleto_enabled?: boolean
          boleto_expiration_days?: number
          card_enabled?: boolean
          checkout_url?: string | null
          created_at?: string
          default_currency?: string
          environment?: string
          id?: string
          is_enabled?: boolean
          last_event_at?: string | null
          offer_id?: string | null
          pix_enabled?: boolean
          pix_expiration_minutes?: number
          post_purchase_url?: string | null
          prod_access_token?: string | null
          prod_public_key?: string | null
          prod_webhook_secret?: string | null
          product_id?: string | null
          provider: string
          public_key?: string | null
          statement_descriptor?: string
          test_access_token?: string | null
          test_public_key?: string | null
          test_webhook_secret?: string | null
          updated_at?: string
          webhook_secret?: string | null
          whatsapp_group_url?: string | null
          wise_api_token?: string | null
          wise_balance_currency?: string | null
          wise_balance_id_eur?: string | null
          wise_bank_address?: string | null
          wise_beneficiary_address?: string | null
          wise_beneficiary_name?: string | null
          wise_bic?: string | null
          wise_confirmation_mode?: string | null
          wise_default_payment_url?: string | null
          wise_environment?: string | null
          wise_iban?: string | null
          wise_last_event_at?: string | null
          wise_profile_id?: string | null
          wise_profile_name?: string | null
          wise_profile_type?: string | null
          wise_webhook_public_key?: string | null
          wise_webhook_subscriptions?: Json
        }
        Update: {
          access_token?: string | null
          boleto_enabled?: boolean
          boleto_expiration_days?: number
          card_enabled?: boolean
          checkout_url?: string | null
          created_at?: string
          default_currency?: string
          environment?: string
          id?: string
          is_enabled?: boolean
          last_event_at?: string | null
          offer_id?: string | null
          pix_enabled?: boolean
          pix_expiration_minutes?: number
          post_purchase_url?: string | null
          prod_access_token?: string | null
          prod_public_key?: string | null
          prod_webhook_secret?: string | null
          product_id?: string | null
          provider?: string
          public_key?: string | null
          statement_descriptor?: string
          test_access_token?: string | null
          test_public_key?: string | null
          test_webhook_secret?: string | null
          updated_at?: string
          webhook_secret?: string | null
          whatsapp_group_url?: string | null
          wise_api_token?: string | null
          wise_balance_currency?: string | null
          wise_balance_id_eur?: string | null
          wise_bank_address?: string | null
          wise_beneficiary_address?: string | null
          wise_beneficiary_name?: string | null
          wise_bic?: string | null
          wise_confirmation_mode?: string | null
          wise_default_payment_url?: string | null
          wise_environment?: string | null
          wise_iban?: string | null
          wise_last_event_at?: string | null
          wise_profile_id?: string | null
          wise_profile_name?: string | null
          wise_profile_type?: string | null
          wise_webhook_public_key?: string | null
          wise_webhook_subscriptions?: Json
        }
        Relationships: []
      }
      lead_activity_log: {
        Row: {
          actor_id: string | null
          actor_label: string | null
          created_at: string
          id: string
          kind: Database["public"]["Enums"]["lead_activity_kind"]
          lead_id: string
          payload: Json
        }
        Insert: {
          actor_id?: string | null
          actor_label?: string | null
          created_at?: string
          id?: string
          kind: Database["public"]["Enums"]["lead_activity_kind"]
          lead_id: string
          payload?: Json
        }
        Update: {
          actor_id?: string | null
          actor_label?: string | null
          created_at?: string
          id?: string
          kind?: Database["public"]["Enums"]["lead_activity_kind"]
          lead_id?: string
          payload?: Json
        }
        Relationships: [
          {
            foreignKeyName: "lead_activity_log_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      leads: {
        Row: {
          assigned_to: string
          budget_range: string | null
          created_at: string
          crm_column_id: string | null
          current_country: string | null
          email: string
          external_id: string | null
          first_message: string | null
          full_name: string
          id: string
          last_inbound_at: string | null
          last_interaction_at: string | null
          last_outbound_at: string | null
          message: string | null
          next_followup_at: string | null
          notes: string | null
          phone: string
          phone_country_iso: string | null
          pipeline_stage: Database["public"]["Enums"]["lead_pipeline_stage"]
          qualification_answers: Json
          qualification_score: number | null
          source: string
          source_detail: string | null
          status: Database["public"]["Enums"]["lead_status"]
          target_visa: string | null
          timeline: string | null
          updated_at: string
          user_id: string | null
          utm_campaign: string | null
          utm_medium: string | null
          utm_source: string | null
        }
        Insert: {
          assigned_to: string
          budget_range?: string | null
          created_at?: string
          crm_column_id?: string | null
          current_country?: string | null
          email: string
          external_id?: string | null
          first_message?: string | null
          full_name: string
          id?: string
          last_inbound_at?: string | null
          last_interaction_at?: string | null
          last_outbound_at?: string | null
          message?: string | null
          next_followup_at?: string | null
          notes?: string | null
          phone: string
          phone_country_iso?: string | null
          pipeline_stage?: Database["public"]["Enums"]["lead_pipeline_stage"]
          qualification_answers?: Json
          qualification_score?: number | null
          source?: string
          source_detail?: string | null
          status?: Database["public"]["Enums"]["lead_status"]
          target_visa?: string | null
          timeline?: string | null
          updated_at?: string
          user_id?: string | null
          utm_campaign?: string | null
          utm_medium?: string | null
          utm_source?: string | null
        }
        Update: {
          assigned_to?: string
          budget_range?: string | null
          created_at?: string
          crm_column_id?: string | null
          current_country?: string | null
          email?: string
          external_id?: string | null
          first_message?: string | null
          full_name?: string
          id?: string
          last_inbound_at?: string | null
          last_interaction_at?: string | null
          last_outbound_at?: string | null
          message?: string | null
          next_followup_at?: string | null
          notes?: string | null
          phone?: string
          phone_country_iso?: string | null
          pipeline_stage?: Database["public"]["Enums"]["lead_pipeline_stage"]
          qualification_answers?: Json
          qualification_score?: number | null
          source?: string
          source_detail?: string | null
          status?: Database["public"]["Enums"]["lead_status"]
          target_visa?: string | null
          timeline?: string | null
          updated_at?: string
          user_id?: string | null
          utm_campaign?: string | null
          utm_medium?: string | null
          utm_source?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "leads_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_crm_column_id_fkey"
            columns: ["crm_column_id"]
            isOneToOne: false
            referencedRelation: "crm_columns"
            referencedColumns: ["id"]
          },
        ]
      }
      member_documents: {
        Row: {
          admin_notes: string | null
          category: string | null
          created_at: string
          file_name: string | null
          file_size_bytes: number | null
          id: string
          member_message: string | null
          mime_type: string | null
          order_id: string | null
          requested_by: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: string
          storage_path: string | null
          title: string
          updated_at: string
          uploaded_at: string | null
          uploaded_by: string | null
          user_id: string
          visible_to_member: boolean
        }
        Insert: {
          admin_notes?: string | null
          category?: string | null
          created_at?: string
          file_name?: string | null
          file_size_bytes?: number | null
          id?: string
          member_message?: string | null
          mime_type?: string | null
          order_id?: string | null
          requested_by?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          storage_path?: string | null
          title: string
          updated_at?: string
          uploaded_at?: string | null
          uploaded_by?: string | null
          user_id: string
          visible_to_member?: boolean
        }
        Update: {
          admin_notes?: string | null
          category?: string | null
          created_at?: string
          file_name?: string | null
          file_size_bytes?: number | null
          id?: string
          member_message?: string | null
          mime_type?: string | null
          order_id?: string | null
          requested_by?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          storage_path?: string | null
          title?: string
          updated_at?: string
          uploaded_at?: string | null
          uploaded_by?: string | null
          user_id?: string
          visible_to_member?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "member_documents_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "member_documents_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "member_documents_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "member_documents_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "member_documents_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      mercadopago_payments: {
        Row: {
          amount_cents: number
          barcode_content: string | null
          created_at: string
          created_by: string | null
          currency: string
          digitable_line: string | null
          expires_at: string | null
          external_reference: string
          id: string
          idempotency_key: string
          last_checked_at: string | null
          order_id: string
          payment_method: string
          payment_type: string | null
          provider_order_id: string | null
          provider_payment_id: string | null
          qr_code: string | null
          qr_code_base64: string | null
          raw_request: Json
          raw_response: Json
          status: string
          status_detail: string | null
          ticket_url: string | null
          updated_at: string
        }
        Insert: {
          amount_cents?: number
          barcode_content?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          digitable_line?: string | null
          expires_at?: string | null
          external_reference: string
          id?: string
          idempotency_key: string
          last_checked_at?: string | null
          order_id: string
          payment_method: string
          payment_type?: string | null
          provider_order_id?: string | null
          provider_payment_id?: string | null
          qr_code?: string | null
          qr_code_base64?: string | null
          raw_request?: Json
          raw_response?: Json
          status?: string
          status_detail?: string | null
          ticket_url?: string | null
          updated_at?: string
        }
        Update: {
          amount_cents?: number
          barcode_content?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          digitable_line?: string | null
          expires_at?: string | null
          external_reference?: string
          id?: string
          idempotency_key?: string
          last_checked_at?: string | null
          order_id?: string
          payment_method?: string
          payment_type?: string | null
          provider_order_id?: string | null
          provider_payment_id?: string | null
          qr_code?: string | null
          qr_code_base64?: string | null
          raw_request?: Json
          raw_response?: Json
          status?: string
          status_detail?: string | null
          ticket_url?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "mercadopago_payments_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mercadopago_payments_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
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
      order_payment_links: {
        Row: {
          access_count: number
          created_at: string
          created_by: string | null
          expires_at: string
          id: string
          last_accessed_at: string | null
          order_id: string
          revoked_at: string | null
          status: string
          token: string
          updated_at: string
          used_at: string | null
        }
        Insert: {
          access_count?: number
          created_at?: string
          created_by?: string | null
          expires_at?: string
          id?: string
          last_accessed_at?: string | null
          order_id: string
          revoked_at?: string | null
          status?: string
          token: string
          updated_at?: string
          used_at?: string | null
        }
        Update: {
          access_count?: number
          created_at?: string
          created_by?: string | null
          expires_at?: string
          id?: string
          last_accessed_at?: string | null
          order_id?: string
          revoked_at?: string | null
          status?: string
          token?: string
          updated_at?: string
          used_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "order_payment_links_order_id_fkey"
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
          external_reference: string | null
          fx_locked_at: string | null
          fx_rate: number | null
          fx_reference_date: string | null
          fx_reference_rate: number | null
          fx_source: string | null
          host_profile_id: string | null
          id: string
          notes: string | null
          paid_at: string | null
          payment_account_id: string | null
          payment_amount_cents: number | null
          payment_currency: string | null
          payment_expires_at: string | null
          payment_method: string | null
          payment_provider: string | null
          payment_provider_order_id: string | null
          payment_provider_payment_id: string | null
          payment_provider_reference: string | null
          payment_status: Database["public"]["Enums"]["order_payment_status"]
          payment_status_detail: string | null
          payment_url: string | null
          service_id: string | null
          service_metadata: Json
          service_title: string
          settled_amount_cents: number | null
          settled_currency: string | null
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
          external_reference?: string | null
          fx_locked_at?: string | null
          fx_rate?: number | null
          fx_reference_date?: string | null
          fx_reference_rate?: number | null
          fx_source?: string | null
          host_profile_id?: string | null
          id?: string
          notes?: string | null
          paid_at?: string | null
          payment_account_id?: string | null
          payment_amount_cents?: number | null
          payment_currency?: string | null
          payment_expires_at?: string | null
          payment_method?: string | null
          payment_provider?: string | null
          payment_provider_order_id?: string | null
          payment_provider_payment_id?: string | null
          payment_provider_reference?: string | null
          payment_status?: Database["public"]["Enums"]["order_payment_status"]
          payment_status_detail?: string | null
          payment_url?: string | null
          service_id?: string | null
          service_metadata?: Json
          service_title: string
          settled_amount_cents?: number | null
          settled_currency?: string | null
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
          external_reference?: string | null
          fx_locked_at?: string | null
          fx_rate?: number | null
          fx_reference_date?: string | null
          fx_reference_rate?: number | null
          fx_source?: string | null
          host_profile_id?: string | null
          id?: string
          notes?: string | null
          paid_at?: string | null
          payment_account_id?: string | null
          payment_amount_cents?: number | null
          payment_currency?: string | null
          payment_expires_at?: string | null
          payment_method?: string | null
          payment_provider?: string | null
          payment_provider_order_id?: string | null
          payment_provider_payment_id?: string | null
          payment_provider_reference?: string | null
          payment_status?: Database["public"]["Enums"]["order_payment_status"]
          payment_status_detail?: string | null
          payment_url?: string | null
          service_id?: string | null
          service_metadata?: Json
          service_title?: string
          settled_amount_cents?: number | null
          settled_currency?: string | null
          slot_id?: string | null
          updated_at?: string
          user_id?: string | null
          voucher_code?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "orders_host_profile_id_fkey"
            columns: ["host_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_payment_account_id_fkey"
            columns: ["payment_account_id"]
            isOneToOne: false
            referencedRelation: "finance_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_slot_id_fkey"
            columns: ["slot_id"]
            isOneToOne: false
            referencedRelation: "availability_slots"
            referencedColumns: ["id"]
          },
        ]
      }
      pdv_activity_logs: {
        Row: {
          action: string
          actor_id: string | null
          actor_name: string | null
          amount_eur_cents: number | null
          customer_id: string | null
          customer_name: string | null
          error_code: string | null
          error_message: string | null
          id: string
          occurred_at: string
          params: Json | null
          payment_method: string | null
          product_id: string | null
          product_name: string | null
          reference: string | null
          request_ip: string | null
          result: Json | null
          route: string | null
          sale_code: string | null
          sale_id: string | null
          source: string
          status: string
          tab_code: string | null
          tab_id: string | null
          user_agent: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          actor_name?: string | null
          amount_eur_cents?: number | null
          customer_id?: string | null
          customer_name?: string | null
          error_code?: string | null
          error_message?: string | null
          id?: string
          occurred_at?: string
          params?: Json | null
          payment_method?: string | null
          product_id?: string | null
          product_name?: string | null
          reference?: string | null
          request_ip?: string | null
          result?: Json | null
          route?: string | null
          sale_code?: string | null
          sale_id?: string | null
          source?: string
          status?: string
          tab_code?: string | null
          tab_id?: string | null
          user_agent?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          actor_name?: string | null
          amount_eur_cents?: number | null
          customer_id?: string | null
          customer_name?: string | null
          error_code?: string | null
          error_message?: string | null
          id?: string
          occurred_at?: string
          params?: Json | null
          payment_method?: string | null
          product_id?: string | null
          product_name?: string | null
          reference?: string | null
          request_ip?: string | null
          result?: Json | null
          route?: string | null
          sale_code?: string | null
          sale_id?: string | null
          source?: string
          status?: string
          tab_code?: string | null
          tab_id?: string | null
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pdv_activity_logs_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      pdv_payment_attempts: {
        Row: {
          amount_brl_cents: number
          amount_eur_cents: number
          attempt_index: number
          cancel_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          created_at: string
          created_by: string
          currency: string
          customer_name_snapshot: string | null
          customer_phone_snapshot: string | null
          discount_brl_cents: number
          discount_eur_cents: number
          discount_type: string
          discount_value: number
          id: string
          notes: string | null
          paid_at: string | null
          payment_url: string | null
          provider: string
          raw_request: Json
          raw_webhook: Json | null
          reference: string
          sale_id: string | null
          status: string
          subtotal_brl_cents: number
          subtotal_eur_cents: number
          tab_id: string
          updated_at: string
        }
        Insert: {
          amount_brl_cents?: number
          amount_eur_cents: number
          attempt_index?: number
          cancel_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          created_at?: string
          created_by: string
          currency?: string
          customer_name_snapshot?: string | null
          customer_phone_snapshot?: string | null
          discount_brl_cents?: number
          discount_eur_cents?: number
          discount_type?: string
          discount_value?: number
          id?: string
          notes?: string | null
          paid_at?: string | null
          payment_url?: string | null
          provider?: string
          raw_request?: Json
          raw_webhook?: Json | null
          reference: string
          sale_id?: string | null
          status?: string
          subtotal_brl_cents?: number
          subtotal_eur_cents?: number
          tab_id: string
          updated_at?: string
        }
        Update: {
          amount_brl_cents?: number
          amount_eur_cents?: number
          attempt_index?: number
          cancel_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          created_at?: string
          created_by?: string
          currency?: string
          customer_name_snapshot?: string | null
          customer_phone_snapshot?: string | null
          discount_brl_cents?: number
          discount_eur_cents?: number
          discount_type?: string
          discount_value?: number
          id?: string
          notes?: string | null
          paid_at?: string | null
          payment_url?: string | null
          provider?: string
          raw_request?: Json
          raw_webhook?: Json | null
          reference?: string
          sale_id?: string | null
          status?: string
          subtotal_brl_cents?: number
          subtotal_eur_cents?: number
          tab_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pdv_payment_attempts_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "pdv_sales"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pdv_payment_attempts_tab_id_fkey"
            columns: ["tab_id"]
            isOneToOne: false
            referencedRelation: "pdv_tabs"
            referencedColumns: ["id"]
          },
        ]
      }
      pdv_sale_code_counters: {
        Row: {
          next_value: number
          sale_date: string
          updated_at: string
        }
        Insert: {
          next_value?: number
          sale_date: string
          updated_at?: string
        }
        Update: {
          next_value?: number
          sale_date?: string
          updated_at?: string
        }
        Relationships: []
      }
      pdv_sale_items: {
        Row: {
          created_at: string
          id: string
          product_emoji_snapshot: string | null
          product_id: string | null
          product_name_snapshot: string
          qty: number
          sale_id: string
          total_brl_cents: number
          total_eur_cents: number
          unit_price_brl_cents: number
          unit_price_eur_cents: number
        }
        Insert: {
          created_at?: string
          id?: string
          product_emoji_snapshot?: string | null
          product_id?: string | null
          product_name_snapshot: string
          qty: number
          sale_id: string
          total_brl_cents?: number
          total_eur_cents?: number
          unit_price_brl_cents?: number
          unit_price_eur_cents?: number
        }
        Update: {
          created_at?: string
          id?: string
          product_emoji_snapshot?: string | null
          product_id?: string | null
          product_name_snapshot?: string
          qty?: number
          sale_id?: string
          total_brl_cents?: number
          total_eur_cents?: number
          unit_price_brl_cents?: number
          unit_price_eur_cents?: number
        }
        Relationships: [
          {
            foreignKeyName: "pdv_sale_items_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "pdv_sales"
            referencedColumns: ["id"]
          },
        ]
      }
      pdv_sales: {
        Row: {
          cashier_id: string
          closed_at: string
          created_at: string
          customer_id: string
          customer_name_snapshot: string | null
          customer_phone_snapshot: string | null
          customer_snapshot_source: string | null
          discount_brl_cents: number
          discount_eur_cents: number
          discount_type: string
          discount_value: number
          id: string
          notes: string | null
          payment_method: string
          sale_code: string
          status: string
          subtotal_brl_cents: number
          subtotal_eur_cents: number
          total_brl_cents: number
          total_eur_cents: number
          updated_at: string
          void_reason: string | null
          voided_at: string | null
          voided_by: string | null
        }
        Insert: {
          cashier_id: string
          closed_at?: string
          created_at?: string
          customer_id: string
          customer_name_snapshot?: string | null
          customer_phone_snapshot?: string | null
          customer_snapshot_source?: string | null
          discount_brl_cents?: number
          discount_eur_cents?: number
          discount_type?: string
          discount_value?: number
          id?: string
          notes?: string | null
          payment_method: string
          sale_code: string
          status?: string
          subtotal_brl_cents?: number
          subtotal_eur_cents?: number
          total_brl_cents?: number
          total_eur_cents?: number
          updated_at?: string
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
        }
        Update: {
          cashier_id?: string
          closed_at?: string
          created_at?: string
          customer_id?: string
          customer_name_snapshot?: string | null
          customer_phone_snapshot?: string | null
          customer_snapshot_source?: string | null
          discount_brl_cents?: number
          discount_eur_cents?: number
          discount_type?: string
          discount_value?: number
          id?: string
          notes?: string | null
          payment_method?: string
          sale_code?: string
          status?: string
          subtotal_brl_cents?: number
          subtotal_eur_cents?: number
          total_brl_cents?: number
          total_eur_cents?: number
          updated_at?: string
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pdv_sales_voided_by_fkey"
            columns: ["voided_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      pdv_tab_code_counters: {
        Row: {
          day: string
          last_value: number
          updated_at: string
        }
        Insert: {
          day: string
          last_value?: number
          updated_at?: string
        }
        Update: {
          day?: string
          last_value?: number
          updated_at?: string
        }
        Relationships: []
      }
      pdv_tab_items: {
        Row: {
          added_by: string
          cancel_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          created_at: string
          id: string
          product_emoji_snapshot: string | null
          product_id: string | null
          product_name_snapshot: string
          qty: number
          tab_id: string
          total_brl_cents: number
          total_eur_cents: number
          unit_price_brl_cents: number
          unit_price_eur_cents: number
          updated_at: string
        }
        Insert: {
          added_by: string
          cancel_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          created_at?: string
          id?: string
          product_emoji_snapshot?: string | null
          product_id?: string | null
          product_name_snapshot: string
          qty: number
          tab_id: string
          total_brl_cents?: number
          total_eur_cents?: number
          unit_price_brl_cents?: number
          unit_price_eur_cents?: number
          updated_at?: string
        }
        Update: {
          added_by?: string
          cancel_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          created_at?: string
          id?: string
          product_emoji_snapshot?: string | null
          product_id?: string | null
          product_name_snapshot?: string
          qty?: number
          tab_id?: string
          total_brl_cents?: number
          total_eur_cents?: number
          unit_price_brl_cents?: number
          unit_price_eur_cents?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pdv_tab_items_added_by_fkey"
            columns: ["added_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pdv_tab_items_cancelled_by_fkey"
            columns: ["cancelled_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pdv_tab_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pdv_tab_items_tab_id_fkey"
            columns: ["tab_id"]
            isOneToOne: false
            referencedRelation: "pdv_tabs"
            referencedColumns: ["id"]
          },
        ]
      }
      pdv_tabs: {
        Row: {
          active_payment_attempt_id: string | null
          awaiting_payment_at: string | null
          cancel_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          closed_at: string | null
          closed_by: string | null
          created_at: string
          customer_id: string
          customer_name_snapshot: string | null
          customer_phone_snapshot: string | null
          customer_snapshot_source: string | null
          discount_brl_cents: number
          discount_eur_cents: number
          discount_type: string
          discount_value: number
          id: string
          notes: string | null
          opened_at: string
          opened_by: string
          payment_method: string | null
          pending_sale_snapshot: Json | null
          sale_id: string | null
          status: string
          subtotal_brl_cents: number
          subtotal_eur_cents: number
          tab_code: string
          total_brl_cents: number
          total_eur_cents: number
          updated_at: string
        }
        Insert: {
          active_payment_attempt_id?: string | null
          awaiting_payment_at?: string | null
          cancel_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          closed_at?: string | null
          closed_by?: string | null
          created_at?: string
          customer_id: string
          customer_name_snapshot?: string | null
          customer_phone_snapshot?: string | null
          customer_snapshot_source?: string | null
          discount_brl_cents?: number
          discount_eur_cents?: number
          discount_type?: string
          discount_value?: number
          id?: string
          notes?: string | null
          opened_at?: string
          opened_by: string
          payment_method?: string | null
          pending_sale_snapshot?: Json | null
          sale_id?: string | null
          status?: string
          subtotal_brl_cents?: number
          subtotal_eur_cents?: number
          tab_code: string
          total_brl_cents?: number
          total_eur_cents?: number
          updated_at?: string
        }
        Update: {
          active_payment_attempt_id?: string | null
          awaiting_payment_at?: string | null
          cancel_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          closed_at?: string | null
          closed_by?: string | null
          created_at?: string
          customer_id?: string
          customer_name_snapshot?: string | null
          customer_phone_snapshot?: string | null
          customer_snapshot_source?: string | null
          discount_brl_cents?: number
          discount_eur_cents?: number
          discount_type?: string
          discount_value?: number
          id?: string
          notes?: string | null
          opened_at?: string
          opened_by?: string
          payment_method?: string | null
          pending_sale_snapshot?: Json | null
          sale_id?: string | null
          status?: string
          subtotal_brl_cents?: number
          subtotal_eur_cents?: number
          tab_code?: string
          total_brl_cents?: number
          total_eur_cents?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pdv_tabs_cancelled_by_fkey"
            columns: ["cancelled_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pdv_tabs_closed_by_fkey"
            columns: ["closed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pdv_tabs_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pdv_tabs_opened_by_fkey"
            columns: ["opened_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pdv_tabs_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: true
            referencedRelation: "pdv_sales"
            referencedColumns: ["id"]
          },
        ]
      }
      product_categories: {
        Row: {
          created_at: string
          emoji: string | null
          id: string
          is_active: boolean
          name: string
          position: number
          slug: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          emoji?: string | null
          id?: string
          is_active?: boolean
          name: string
          position?: number
          slug: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          emoji?: string | null
          id?: string
          is_active?: boolean
          name?: string
          position?: number
          slug?: string
          updated_at?: string
        }
        Relationships: []
      }
      product_stock_movements: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          new_stock: number
          previous_stock: number
          product_id: string
          quantity: number
          reason: string | null
          sale_id: string | null
          tab_id: string | null
          tab_item_id: string | null
          type: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          new_stock?: number
          previous_stock?: number
          product_id: string
          quantity: number
          reason?: string | null
          sale_id?: string | null
          tab_id?: string | null
          tab_item_id?: string | null
          type: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          new_stock?: number
          previous_stock?: number
          product_id?: string
          quantity?: number
          reason?: string | null
          sale_id?: string | null
          tab_id?: string | null
          tab_item_id?: string | null
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_stock_movements_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_stock_movements_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "pdv_sales"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_stock_movements_tab_id_fkey"
            columns: ["tab_id"]
            isOneToOne: false
            referencedRelation: "pdv_tabs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_stock_movements_tab_item_id_fkey"
            columns: ["tab_item_id"]
            isOneToOne: false
            referencedRelation: "pdv_tab_items"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          available_stock_quantity: number | null
          category: Database["public"]["Enums"]["product_category"]
          category_id: string
          created_at: string
          emoji: string | null
          id: string
          is_active: boolean
          item_type: string
          name: string
          position: number
          price_brl_cents: number
          price_cents: number
          price_eur_cents: number
          reserved_stock_quantity: number
          slug: string
          stock_min_quantity: number
          stock_quantity: number
          track_stock: boolean
          updated_at: string
        }
        Insert: {
          available_stock_quantity?: number | null
          category?: Database["public"]["Enums"]["product_category"]
          category_id: string
          created_at?: string
          emoji?: string | null
          id?: string
          is_active?: boolean
          item_type?: string
          name: string
          position?: number
          price_brl_cents?: number
          price_cents?: number
          price_eur_cents?: number
          reserved_stock_quantity?: number
          slug: string
          stock_min_quantity?: number
          stock_quantity?: number
          track_stock?: boolean
          updated_at?: string
        }
        Update: {
          available_stock_quantity?: number | null
          category?: Database["public"]["Enums"]["product_category"]
          category_id?: string
          created_at?: string
          emoji?: string | null
          id?: string
          is_active?: boolean
          item_type?: string
          name?: string
          position?: number
          price_brl_cents?: number
          price_cents?: number
          price_eur_cents?: number
          reserved_stock_quantity?: number
          slug?: string
          stock_min_quantity?: number
          stock_quantity?: number
          track_stock?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "products_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "product_categories"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          admin_notes: string | null
          avatar_url: string | null
          country_origin: string | null
          created_at: string
          created_by_admin: boolean
          created_by_staff_id: string | null
          first_access_completed_at: string | null
          full_name: string | null
          id: string
          is_blocked: boolean
          member_next_step: string | null
          member_status: string
          member_status_updated_at: string | null
          member_status_updated_by: string | null
          password_setup_required: boolean
          phone: string | null
          phone_country_iso: string | null
          profile_origin: string
          updated_at: string
        }
        Insert: {
          admin_notes?: string | null
          avatar_url?: string | null
          country_origin?: string | null
          created_at?: string
          created_by_admin?: boolean
          created_by_staff_id?: string | null
          first_access_completed_at?: string | null
          full_name?: string | null
          id: string
          is_blocked?: boolean
          member_next_step?: string | null
          member_status?: string
          member_status_updated_at?: string | null
          member_status_updated_by?: string | null
          password_setup_required?: boolean
          phone?: string | null
          phone_country_iso?: string | null
          profile_origin?: string
          updated_at?: string
        }
        Update: {
          admin_notes?: string | null
          avatar_url?: string | null
          country_origin?: string | null
          created_at?: string
          created_by_admin?: boolean
          created_by_staff_id?: string | null
          first_access_completed_at?: string | null
          full_name?: string | null
          id?: string
          is_blocked?: boolean
          member_next_step?: string | null
          member_status?: string
          member_status_updated_at?: string | null
          member_status_updated_by?: string | null
          password_setup_required?: boolean
          phone?: string | null
          phone_country_iso?: string | null
          profile_origin?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_created_by_staff_id_fkey"
            columns: ["created_by_staff_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profiles_member_status_updated_by_fkey"
            columns: ["member_status_updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      services: {
        Row: {
          category: Database["public"]["Enums"]["service_category"]
          created_at: string
          currency: string
          description: string | null
          display_price_note: string | null
          document_checklist: Json
          duration_minutes: number | null
          id: string
          image_url: string | null
          is_active: boolean
          kind: Database["public"]["Enums"]["service_kind"] | null
          meeting_address: string | null
          online_currency: string
          online_price_cents: number | null
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
          display_price_note?: string | null
          document_checklist?: Json
          duration_minutes?: number | null
          id?: string
          image_url?: string | null
          is_active?: boolean
          kind?: Database["public"]["Enums"]["service_kind"] | null
          meeting_address?: string | null
          online_currency?: string
          online_price_cents?: number | null
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
          display_price_note?: string | null
          document_checklist?: Json
          duration_minutes?: number | null
          id?: string
          image_url?: string | null
          is_active?: boolean
          kind?: Database["public"]["Enums"]["service_kind"] | null
          meeting_address?: string | null
          online_currency?: string
          online_price_cents?: number | null
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
      staff_action_permissions: {
        Row: {
          action_key: string
          created_at: string
          id: string
          is_allowed: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          action_key: string
          created_at?: string
          id?: string
          is_allowed?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          action_key?: string
          created_at?: string
          id?: string
          is_allowed?: boolean
          updated_at?: string
          user_id?: string
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
      staff_module_permissions: {
        Row: {
          created_at: string
          id: string
          is_allowed: boolean
          module_key: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_allowed?: boolean
          module_key: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          is_allowed?: boolean
          module_key?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "staff_module_permissions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      tab_items: {
        Row: {
          added_by: string | null
          benefit_label: string | null
          created_at: string
          discount_cents: number
          id: string
          product_emoji: string | null
          product_id: string | null
          product_name_snapshot: string
          qty: number
          tab_id: string
          unit_price_cents: number
        }
        Insert: {
          added_by?: string | null
          benefit_label?: string | null
          created_at?: string
          discount_cents?: number
          id?: string
          product_emoji?: string | null
          product_id?: string | null
          product_name_snapshot: string
          qty?: number
          tab_id: string
          unit_price_cents?: number
        }
        Update: {
          added_by?: string | null
          benefit_label?: string | null
          created_at?: string
          discount_cents?: number
          id?: string
          product_emoji?: string | null
          product_id?: string | null
          product_name_snapshot?: string
          qty?: number
          tab_id?: string
          unit_price_cents?: number
        }
        Relationships: [
          {
            foreignKeyName: "tab_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tab_items_tab_id_fkey"
            columns: ["tab_id"]
            isOneToOne: false
            referencedRelation: "tabs"
            referencedColumns: ["id"]
          },
        ]
      }
      tabs: {
        Row: {
          closed_at: string | null
          created_at: string
          id: string
          opened_at: string
          opened_by: string | null
          order_id: string | null
          paid_cents: number
          payment_method: string | null
          status: Database["public"]["Enums"]["tab_status"]
          total_cents: number
          updated_at: string
          user_id: string
        }
        Insert: {
          closed_at?: string | null
          created_at?: string
          id?: string
          opened_at?: string
          opened_by?: string | null
          order_id?: string | null
          paid_cents?: number
          payment_method?: string | null
          status?: Database["public"]["Enums"]["tab_status"]
          total_cents?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          closed_at?: string | null
          created_at?: string
          id?: string
          opened_at?: string
          opened_by?: string | null
          order_id?: string | null
          paid_cents?: number
          payment_method?: string | null
          status?: Database["public"]["Enums"]["tab_status"]
          total_cents?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tabs_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
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
      wise_events: {
        Row: {
          created_at: string
          event_id: string | null
          event_type: string
          id: string
          match_status: string
          matched_order_id: string | null
          matched_payment_id: string | null
          notes: string | null
          payload: Json
          processed_at: string | null
          signature_valid: boolean
          updated_at: string
        }
        Insert: {
          created_at?: string
          event_id?: string | null
          event_type: string
          id?: string
          match_status?: string
          matched_order_id?: string | null
          matched_payment_id?: string | null
          notes?: string | null
          payload: Json
          processed_at?: string | null
          signature_valid?: boolean
          updated_at?: string
        }
        Update: {
          created_at?: string
          event_id?: string | null
          event_type?: string
          id?: string
          match_status?: string
          matched_order_id?: string | null
          matched_payment_id?: string | null
          notes?: string | null
          payload?: Json
          processed_at?: string | null
          signature_valid?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "wise_events_matched_order_id_fkey"
            columns: ["matched_order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wise_events_matched_payment_id_fkey"
            columns: ["matched_payment_id"]
            isOneToOne: false
            referencedRelation: "wise_payments"
            referencedColumns: ["id"]
          },
        ]
      }
      wise_payments: {
        Row: {
          amount_cents: number
          created_at: string
          currency: string
          description: string | null
          external_reference: string
          id: string
          order_id: string
          paid_at: string | null
          raw_request: Json | null
          raw_response: Json | null
          raw_webhook: Json | null
          status: string
          updated_at: string
          wise_balance_credit_id: string | null
          wise_payment_link_id: string | null
          wise_payment_link_url: string | null
          wise_transfer_id: string | null
        }
        Insert: {
          amount_cents: number
          created_at?: string
          currency?: string
          description?: string | null
          external_reference: string
          id?: string
          order_id: string
          paid_at?: string | null
          raw_request?: Json | null
          raw_response?: Json | null
          raw_webhook?: Json | null
          status?: string
          updated_at?: string
          wise_balance_credit_id?: string | null
          wise_payment_link_id?: string | null
          wise_payment_link_url?: string | null
          wise_transfer_id?: string | null
        }
        Update: {
          amount_cents?: number
          created_at?: string
          currency?: string
          description?: string | null
          external_reference?: string
          id?: string
          order_id?: string
          paid_at?: string | null
          raw_request?: Json | null
          raw_response?: Json | null
          raw_webhook?: Json | null
          status?: string
          updated_at?: string
          wise_balance_credit_id?: string | null
          wise_payment_link_id?: string | null
          wise_payment_link_url?: string | null
          wise_transfer_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "wise_payments_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      crm_automation_increment_metric: {
        Args: { p_amount?: number; p_flow_id: string; p_key: string }
        Returns: undefined
      }
      crm_automation_stop_for_lead: {
        Args: { p_lead_id: string; p_reason: string; p_step_id?: string }
        Returns: undefined
      }
      email_exists: { Args: { p_email: string }; Returns: boolean }
      finance_account_id_for_payment: {
        Args: { p_currency: string; p_payment_method: string }
        Returns: string
      }
      finance_category_id: {
        Args: { p_name: string; p_type: string }
        Returns: string
      }
      finance_close_month: {
        Args: { p_actor: string; p_month: string }
        Returns: Json
      }
      finance_dashboard_month: { Args: { p_month: string }; Returns: Json }
      finance_ensure_month: {
        Args: { p_actor?: string; p_month: string }
        Returns: undefined
      }
      finance_materialize_payout: {
        Args: {
          p_actor?: string
          p_currency: string
          p_month: string
          p_rule_id: string
        }
        Returns: string
      }
      finance_month_is_closed: { Args: { p_month: string }; Returns: boolean }
      finance_month_snapshot: {
        Args: { p_include_projection?: boolean; p_month: string }
        Returns: Json
      }
      finance_payout_base: {
        Args: { p_currency: string; p_month: string; p_rule_id: string }
        Returns: number
      }
      finance_payout_projection: {
        Args: { p_month: string }
        Returns: {
          base_amount_cents: number
          currency: string
          payee_id: string
          payout_id: string
          percentage: number
          projected_amount_cents: number
          rule_id: string
        }[]
      }
      finance_prepare_month: {
        Args: { p_actor: string; p_month: string }
        Returns: Json
      }
      finance_sync_order: { Args: { p_order_id: string }; Returns: undefined }
      finance_sync_pdv_sale: { Args: { p_sale_id: string }; Returns: undefined }
      has_action: {
        Args: { _action: string; _user_id: string }
        Returns: boolean
      }
      has_module_access: {
        Args: { _module: string; _user_id: string }
        Returns: boolean
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_staff: { Args: { _user_id: string }; Returns: boolean }
      pdv_add_tab_item: {
        Args: {
          p_actor_id: string
          p_product_id: string
          p_qty: number
          p_tab_id: string
        }
        Returns: string
      }
      pdv_cancel_tab: {
        Args: { p_actor_id: string; p_reason: string; p_tab_id: string }
        Returns: undefined
      }
      pdv_cancel_tab_item: {
        Args: { p_actor_id: string; p_item_id: string; p_reason: string }
        Returns: undefined
      }
      pdv_cancel_wise_attempt: {
        Args: { p_actor_id: string; p_attempt_id: string; p_reason: string }
        Returns: undefined
      }
      pdv_close_sale: {
        Args: {
          p_cashier_id: string
          p_customer_id: string
          p_discount_type: string
          p_discount_value: number
          p_items: Json
          p_notes: string
          p_payment_method: string
        }
        Returns: string
      }
      pdv_close_tab: {
        Args: {
          p_cashier_id: string
          p_discount_type: string
          p_discount_value: number
          p_notes?: string
          p_payment_method: string
          p_tab_id: string
        }
        Returns: string
      }
      pdv_confirm_wise_payment: {
        Args: {
          p_amount_cents: number
          p_currency: string
          p_raw: Json
          p_reference: string
        }
        Returns: Json
      }
      pdv_next_sale_code: { Args: { p_closed_at?: string }; Returns: string }
      pdv_next_tab_code: { Args: { p_at?: string }; Returns: string }
      pdv_open_tab: {
        Args: { p_customer_id: string; p_notes?: string; p_opened_by: string }
        Returns: Json
      }
      pdv_request_wise_payment: {
        Args: {
          p_actor_id: string
          p_discount_type: string
          p_discount_value: number
          p_notes?: string
          p_payment_url: string
          p_tab_id: string
        }
        Returns: Json
      }
      pdv_update_tab_item_qty: {
        Args: { p_actor_id: string; p_item_id: string; p_qty: number }
        Returns: undefined
      }
      pdv_void_sale: {
        Args: { p_admin_id: string; p_reason: string; p_sale_id: string }
        Returns: undefined
      }
      wise_next_reference: { Args: never; Returns: string }
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
      benefit_kind: "desconto_pct" | "desconto_fixo" | "cortesia"
      benefit_scope: "produto" | "categoria"
      calendar_task_priority: "baixa" | "media" | "alta" | "urgente"
      calendar_task_status:
        | "pendente"
        | "em_andamento"
        | "concluida"
        | "cancelada"
      crm_column_type: "system" | "custom"
      crm_distribution_mode: "fixed" | "round_robin"
      crm_followup_mode: "manual" | "suggestion" | "automatic"
      crm_followup_status: "pending" | "done" | "skipped" | "canceled"
      crm_inbox_status: "received" | "suggested" | "linked" | "ignored"
      crm_message_direction: "inbound" | "outbound"
      event_sales_mode: "simples" | "categorias"
      event_ticket_status: "valido" | "usado" | "cancelado"
      lead_activity_kind:
        | "created"
        | "stage_changed"
        | "note_added"
        | "meeting_scheduled"
        | "whatsapp_opened"
        | "owner_changed"
        | "followup_created"
        | "followup_done"
        | "inbox_message_linked"
        | "followup_sent"
        | "followup_delayed"
        | "followup_canceled"
        | "message_inbound"
        | "message_outbound"
      lead_pipeline_stage:
        | "novo"
        | "analise"
        | "qualificado"
        | "descartado"
        | "em_contato"
        | "reuniao"
        | "fechado"
      lead_status: "novo" | "contatado" | "qualificado" | "fechado" | "perdido"
      order_delivery_status:
        | "aguardando_pagamento"
        | "aguardando_documentos"
        | "processando"
        | "agendado"
        | "concluido"
      order_payment_status: "pendente" | "aprovado" | "recusado" | "estornado"
      product_category: "bebida" | "comida" | "barbearia" | "outro"
      service_category: "esteira1" | "esteira2" | "clube"
      service_kind: "airport" | "tour" | "consulting" | "banking" | "meeting"
      tab_status: "aberta" | "paga" | "cancelada"
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
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
      benefit_kind: ["desconto_pct", "desconto_fixo", "cortesia"],
      benefit_scope: ["produto", "categoria"],
      calendar_task_priority: ["baixa", "media", "alta", "urgente"],
      calendar_task_status: [
        "pendente",
        "em_andamento",
        "concluida",
        "cancelada",
      ],
      crm_column_type: ["system", "custom"],
      crm_distribution_mode: ["fixed", "round_robin"],
      crm_followup_mode: ["manual", "suggestion", "automatic"],
      crm_followup_status: ["pending", "done", "skipped", "canceled"],
      crm_inbox_status: ["received", "suggested", "linked", "ignored"],
      crm_message_direction: ["inbound", "outbound"],
      event_sales_mode: ["simples", "categorias"],
      event_ticket_status: ["valido", "usado", "cancelado"],
      lead_activity_kind: [
        "created",
        "stage_changed",
        "note_added",
        "meeting_scheduled",
        "whatsapp_opened",
        "owner_changed",
        "followup_created",
        "followup_done",
        "inbox_message_linked",
        "followup_sent",
        "followup_delayed",
        "followup_canceled",
        "message_inbound",
        "message_outbound",
      ],
      lead_pipeline_stage: [
        "novo",
        "analise",
        "qualificado",
        "descartado",
        "em_contato",
        "reuniao",
        "fechado",
      ],
      lead_status: ["novo", "contatado", "qualificado", "fechado", "perdido"],
      order_delivery_status: [
        "aguardando_pagamento",
        "aguardando_documentos",
        "processando",
        "agendado",
        "concluido",
      ],
      order_payment_status: ["pendente", "aprovado", "recusado", "estornado"],
      product_category: ["bebida", "comida", "barbearia", "outro"],
      service_category: ["esteira1", "esteira2", "clube"],
      service_kind: ["airport", "tour", "consulting", "banking", "meeting"],
      tab_status: ["aberta", "paga", "cancelada"],
    },
  },
} as const
