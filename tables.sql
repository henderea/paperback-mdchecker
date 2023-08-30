create table user_id (
  user_id text not null,
  roles text,
  constraint pk_user primary key (user_id)
);

create table user_manga (
  user_id text not null,
  manga_id text not null,
  last_check bigint,
  last_update bigint,
  manga_title text,
  constraint pk_user_manga primary key (user_id, manga_id),
  constraint fk_user_manga_user_id foreign key (user_id) references user_id (user_id)
);

create index ix_user_manga_manga_id_last_check on user_manga (manga_id, last_check);
create index ix_user_manga_user_id_manga_id_last_update_last_check on user_manga (user_id, manga_id, last_update, last_check);
create index ix_user_manga_user_id_last_check_last_update on user_manga (user_id, last_check, last_update);
create index ix_user_manga_last_update_last_check on user_manga (last_update, last_check);

create table update_check (
  check_start_time bigint not null,
  check_end_time bigint,
  update_count integer not null default 0,
  constraint pk_update_check primary key (check_start_time)
);

create index ix_update_check_update_count_check_start_time on update_check (update_count, check_start_time);
