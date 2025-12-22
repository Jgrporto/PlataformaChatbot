export const SQL_MIGRATIONS = [
  {
    id: 1,
    name: "init",
    sql: `
      create table if not exists devices (
        id text primary key,
        name text not null,
        status text not null default 'disconnected',
        last_activity text,
        last_error text,
        created_at text not null default (datetime('now')),
        updated_at text not null default (datetime('now'))
      );

      create table if not exists chatbot_commands (
        id integer primary key autoincrement,
        token text not null unique,
        flow text not null,
        enabled integer not null default 1,
        created_at text not null default (datetime('now')),
        updated_at text not null default (datetime('now'))
      );

      create table if not exists chatbot_quick_replies (
        id integer primary key autoincrement,
        trigger text not null,
        response text not null,
        match_type text not null default 'includes',
        enabled integer not null default 1,
        created_at text not null default (datetime('now')),
        updated_at text not null default (datetime('now'))
      );

      create table if not exists chatbot_flows (
        id integer primary key autoincrement,
        name text not null unique,
        triggers_json text not null default '[]',
        stages_json text not null default '[]',
        flow_type text not null default 'custom',
        enabled integer not null default 1,
        created_at text not null default (datetime('now')),
        updated_at text not null default (datetime('now'))
      );

      create table if not exists interactions (
        id integer primary key autoincrement,
        device_id text,
        phone text,
        name text,
        contact_type text,
        origin text,
        event_type text not null,
        command text,
        flow text,
        stage text,
        content text,
        message_id text,
        error_type text,
        error_details text,
        created_at text not null default (datetime('now'))
      );

      create table if not exists messages (
        id integer primary key autoincrement,
        device_id text,
        phone text,
        chat_id text,
        origin text,
        direction text not null,
        message_type text,
        content text,
        created_at text not null default (datetime('now'))
      );

      create table if not exists api_tests (
        id integer primary key autoincrement,
        device_id text,
        flow text,
        payload_json text,
        response_json text,
        status text not null,
        error_text text,
        created_at text not null default (datetime('now'))
      );

      create index if not exists idx_interactions_phone on interactions(phone);
      create index if not exists idx_interactions_device on interactions(device_id);
      create index if not exists idx_messages_phone on messages(phone);
      create index if not exists idx_messages_device on messages(device_id);
      create index if not exists idx_tests_status on api_tests(status);
    `
  }
];
