create table user_id (
  user_id text not null,
  roles text,
  pushover_token text,
  pushover_app_token_override text,
  constraint pk_user primary key (user_id)
);

create table user_manga (
  user_id text not null,
  manga_id text not null,
  last_check bigint,
  last_update bigint,
  manga_title text,
  manga_status text,
  last_title_check bigint not null default 0,
  last_deep_check bigint not null default 0,
  last_deep_check_find bigint not null default 0,
  constraint pk_user_manga primary key (user_id, manga_id),
  constraint fk_user_manga_user_id foreign key (user_id) references user_id (user_id)
);

create index ix_user_manga_mid_lcheck on user_manga (manga_id, last_check);
create index ix_user_manga_uid_mid_lcheck_lupdate_mtitle on user_manga (user_id, manga_id, last_check, last_update, manga_title);
create index ix_user_manga_uid_lcheck_lupdate on user_manga (user_id, last_check, last_update);
create index ix_user_manga_uid_mid_lcheck_lupdate on user_manga (user_id, manga_id, last_check, last_update);
create index ix_user_manga_lupdate_lcheck on user_manga (last_update, last_check);
create index ix_user_manga_ltitle_check_lupdate_lcheck_mid on user_manga (last_title_check, last_update, last_check, manga_id);
create index ix_user_manga_ldeep_check_lupdate_lcheck_mid on user_manga (last_deep_check, last_update, last_check, manga_id);
create index ix_user_manga_lcheck_mid on user_manga (last_check, manga_id);
create index ix_user_manga_uid_mid_mtitle on user_manga (user_id, manga_id, manga_title);
create index ix_user_manga_mstatus_mid_mtitle on user_manga (manga_status, manga_id, manga_title);

create or replace view user_manga_view as
  select user_id,
         manga_id,
         case when last_check = 0 then null else timezone('US/Eastern', to_timestamp(last_check / 1000.0)) end as last_check,
         case when last_update = 0 then null else timezone('US/Eastern', to_timestamp(last_update / 1000.0)) end as last_update,
         manga_title,
         manga_status,
         case when last_title_check = 0 then null else timezone('US/Eastern', to_timestamp(last_title_check / 1000.0)) end as last_title_check,
         case when last_deep_check = 0 then null else timezone('US/Eastern', to_timestamp(last_deep_check / 1000.0)) end as last_deep_check,
         case when last_deep_check_find = 0 then null else timezone('US/Eastern', to_timestamp(last_deep_check_find / 1000.0)) end as last_deep_check_find
  from user_manga;

create table update_check (
  check_start_time bigint not null,
  check_end_time bigint,
  update_count integer not null default 0,
  hit_page_fetch_limit boolean not null default false,
  constraint pk_update_check primary key (check_start_time)
);

create index ix_update_check_cstart_time_ucount on update_check (check_start_time, update_count);

create or replace view update_check_view as
  select timezone('US/Eastern', to_timestamp(check_start_time / 1000.0)) as check_start_time,
         case when check_end_time is null then null else timezone('US/Eastern', to_timestamp(check_end_time / 1000.0)) end as check_end_time,
         case when check_end_time is null then null else check_end_time - check_start_time end as check_duration,
         update_count,
         hit_page_fetch_limit
  from update_check;

create table deep_check (
  check_start_time bigint not null,
  check_end_time bigint,
  update_count integer not null default 0,
  check_count integer not null default 0,
  constraint pk_deep_check primary key (check_start_time)
);

create index ix_deep_check_cstart_time_ucount on deep_check (check_start_time, update_count);
create index ix_deep_check_cstart_time_ccount on deep_check (check_start_time, check_count);

create or replace view deep_check_view as
  select timezone('US/Eastern', to_timestamp(check_start_time / 1000.0)) as check_start_time,
         case when check_end_time is null then null else timezone('US/Eastern', to_timestamp(check_end_time / 1000.0)) end as check_end_time,
         case when check_end_time is null then null else check_end_time - check_start_time end as check_duration,
         update_count,
         check_count,
         case when check_count <= 0 then null else round((check_end_time - check_start_time)::numeric / check_count::numeric, 1) end as avg_check_time
  from deep_check;

create table failed_titles (
  manga_id text not null,
  last_failure bigint not null,
  constraint pk_failed_titles primary key (manga_id)
);

create index ix_failed_titles_lfailure_mid on failed_titles (last_failure, manga_id);
