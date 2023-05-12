create table user (
  user_id text not null,
  constraint pk_user primary key (user_id)
);

create table user_manga (
  user_id text not null,
  manga_id text not null,
  last_check number,
  last_update number,
  constraint pk_user_manga primary key (user_id, manga_id),
  constraint fk_user_manga_user_id foreign key (user_id) references user (user_id)
);

create index ix_user_manga_manga_id_last_check on user_manga (manga_id, last_check);
create index ix_user_manga_user_id_last_check on user_manga (user_id, last_check);
