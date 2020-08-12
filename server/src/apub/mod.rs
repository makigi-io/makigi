pub mod activities;
pub mod comment;
pub mod community;
pub mod extensions;
pub mod fetcher;
pub mod inbox;
pub mod post;
pub mod private_message;
pub mod user;

use crate::{
  apub::extensions::{
    group_extensions::GroupExtension,
    page_extension::PageExtension,
    signatures::{PublicKey, PublicKeyExtension},
  },
  blocking,
  request::{retry, RecvError},
  routes::webfinger::WebFingerResponse,
  DbPool,
  LemmyError,
};
use activitystreams::{
  activity::Follow,
  actor::{ApActor, Group, Person},
  base::AsBase,
  markers::Base,
  object::{Page, Tombstone},
  prelude::*,
};
use activitystreams_ext::{Ext1, Ext2};
use actix_web::{body::Body, client::Client, HttpResponse};
use anyhow::{anyhow, Context};
use chrono::NaiveDateTime;
use lemmy_db::{activity::do_insert_activity, user::User_};
use lemmy_utils::{
  convert_datetime,
  get_apub_protocol_string,
  location_info,
  settings::Settings,
  MentionData,
};
use log::debug;
use serde::Serialize;
use url::{ParseError, Url};

type GroupExt = Ext2<ApActor<Group>, GroupExtension, PublicKeyExtension>;
type PersonExt = Ext1<ApActor<Person>, PublicKeyExtension>;
type PageExt = Ext1<Page, PageExtension>;

pub static APUB_JSON_CONTENT_TYPE: &str = "application/activity+json";

/// Convert the data to json and turn it into an HTTP Response with the correct ActivityPub
/// headers.
fn create_apub_response<T>(data: &T) -> HttpResponse<Body>
where
  T: Serialize,
{
  HttpResponse::Ok()
    .content_type(APUB_JSON_CONTENT_TYPE)
    .json(data)
}

fn create_apub_tombstone_response<T>(data: &T) -> HttpResponse<Body>
where
  T: Serialize,
{
  HttpResponse::Gone()
    .content_type(APUB_JSON_CONTENT_TYPE)
    .json(data)
}

// Checks if the ID has a valid format, correct scheme, and is in the allowed instance list.
fn check_is_apub_id_valid(apub_id: &Url) -> Result<(), LemmyError> {
  if apub_id.scheme() != get_apub_protocol_string() {
    return Err(anyhow!("invalid apub id scheme: {:?}", apub_id.scheme()).into());
  }

  let mut allowed_instances: Vec<String> = Settings::get().get_allowed_instances();

  // need to allow this explicitly because apub activities might contain objects from our local
  // instance. replace is needed to remove the port in our federation test setup.
  let settings = Settings::get();
  let local_instance = settings.hostname.split(':').collect::<Vec<&str>>();
  allowed_instances.push(
    local_instance
      .first()
      .context(location_info!())?
      .to_string(),
  );

  match apub_id.domain() {
    Some(d) => {
      let contains = allowed_instances.contains(&d.to_owned());

      if !contains {
        return Err(anyhow!("{} not in federation allowlist", d).into());
      }

      Ok(())
    }
    None => Err(anyhow!("federation allowlist is empty").into()),
  }
}

#[async_trait::async_trait(?Send)]
pub trait ToApub {
  type Response;
  async fn to_apub(&self, pool: &DbPool) -> Result<Self::Response, LemmyError>;
  fn to_tombstone(&self) -> Result<Tombstone, LemmyError>;
}

/// Updated is actually the deletion time
fn create_tombstone<T>(
  deleted: bool,
  object_id: &str,
  updated: Option<NaiveDateTime>,
  former_type: T,
) -> Result<Tombstone, LemmyError>
where
  T: ToString,
{
  if deleted {
    if let Some(updated) = updated {
      let mut tombstone = Tombstone::new();
      tombstone.set_id(object_id.parse()?);
      tombstone.set_former_type(former_type.to_string());
      tombstone.set_deleted(convert_datetime(updated));
      Ok(tombstone)
    } else {
      Err(anyhow!("Cant convert to tombstone because updated time was None.").into())
    }
  } else {
    Err(anyhow!("Cant convert object to tombstone if it wasnt deleted").into())
  }
}

#[async_trait::async_trait(?Send)]
pub trait FromApub {
  type ApubType;
  /// Converts an object from ActivityPub type to Lemmy internal type.
  ///
  /// * `apub` The object to read from
  /// * `client` Web client to fetch remote actors with
  /// * `pool` Database connection
  /// * `expected_domain` If present, ensure that the apub object comes from the same domain as
  ///                     this URL
  ///
  async fn from_apub(
    apub: &Self::ApubType,
    client: &Client,
    pool: &DbPool,
    expected_domain: Option<Url>,
  ) -> Result<Self, LemmyError>
  where
    Self: Sized;
}

#[async_trait::async_trait(?Send)]
pub trait ApubObjectType {
  async fn send_create(
    &self,
    creator: &User_,
    client: &Client,
    pool: &DbPool,
  ) -> Result<(), LemmyError>;
  async fn send_update(
    &self,
    creator: &User_,
    client: &Client,
    pool: &DbPool,
  ) -> Result<(), LemmyError>;
  async fn send_delete(
    &self,
    creator: &User_,
    client: &Client,
    pool: &DbPool,
  ) -> Result<(), LemmyError>;
  async fn send_undo_delete(
    &self,
    creator: &User_,
    client: &Client,
    pool: &DbPool,
  ) -> Result<(), LemmyError>;
  async fn send_remove(
    &self,
    mod_: &User_,
    client: &Client,
    pool: &DbPool,
  ) -> Result<(), LemmyError>;
  async fn send_undo_remove(
    &self,
    mod_: &User_,
    client: &Client,
    pool: &DbPool,
  ) -> Result<(), LemmyError>;
}

pub(in crate::apub) fn check_actor_domain<T, Kind>(
  apub: &T,
  expected_domain: Option<Url>,
) -> Result<String, LemmyError>
where
  T: Base + AsBase<Kind>,
{
  let actor_id = if let Some(url) = expected_domain {
    let domain = url.domain().context(location_info!())?;
    apub.id(domain)?.context(location_info!())?
  } else {
    let actor_id = apub.id_unchecked().context(location_info!())?;
    check_is_apub_id_valid(&actor_id)?;
    actor_id
  };
  Ok(actor_id.to_string())
}

#[async_trait::async_trait(?Send)]
pub trait ApubLikeableType {
  async fn send_like(
    &self,
    creator: &User_,
    client: &Client,
    pool: &DbPool,
  ) -> Result<(), LemmyError>;
  async fn send_dislike(
    &self,
    creator: &User_,
    client: &Client,
    pool: &DbPool,
  ) -> Result<(), LemmyError>;
  async fn send_undo_like(
    &self,
    creator: &User_,
    client: &Client,
    pool: &DbPool,
  ) -> Result<(), LemmyError>;
}

#[async_trait::async_trait(?Send)]
pub trait ActorType {
  fn actor_id_str(&self) -> String;

  // TODO: every actor should have a public key, so this shouldnt be an option (needs to be fixed in db)
  fn public_key(&self) -> Option<String>;
  fn private_key(&self) -> Option<String>;

  /// numeric id in the database, used for insert_activity
  fn user_id(&self) -> i32;

  // These two have default impls, since currently a community can't follow anything,
  // and a user can't be followed (yet)
  #[allow(unused_variables)]
  async fn send_follow(
    &self,
    follow_actor_id: &Url,
    client: &Client,
    pool: &DbPool,
  ) -> Result<(), LemmyError>;
  async fn send_unfollow(
    &self,
    follow_actor_id: &Url,
    client: &Client,
    pool: &DbPool,
  ) -> Result<(), LemmyError>;

  #[allow(unused_variables)]
  async fn send_accept_follow(
    &self,
    follow: Follow,
    client: &Client,
    pool: &DbPool,
  ) -> Result<(), LemmyError>;

  async fn send_delete(
    &self,
    creator: &User_,
    client: &Client,
    pool: &DbPool,
  ) -> Result<(), LemmyError>;
  async fn send_undo_delete(
    &self,
    creator: &User_,
    client: &Client,
    pool: &DbPool,
  ) -> Result<(), LemmyError>;

  async fn send_remove(
    &self,
    mod_: &User_,
    client: &Client,
    pool: &DbPool,
  ) -> Result<(), LemmyError>;
  async fn send_undo_remove(
    &self,
    mod_: &User_,
    client: &Client,
    pool: &DbPool,
  ) -> Result<(), LemmyError>;

  /// For a given community, returns the inboxes of all followers.
  async fn get_follower_inboxes(&self, pool: &DbPool) -> Result<Vec<Url>, LemmyError>;

  fn actor_id(&self) -> Result<Url, ParseError> {
    Url::parse(&self.actor_id_str())
  }

  // TODO move these to the db rows
  fn get_inbox_url(&self) -> Result<Url, ParseError> {
    Url::parse(&format!("{}/inbox", &self.actor_id_str()))
  }

  fn get_shared_inbox_url(&self) -> Result<Url, LemmyError> {
    let actor_id = self.actor_id()?;
    let url = format!(
      "{}://{}{}/inbox",
      &actor_id.scheme(),
      &actor_id.host_str().context(location_info!())?,
      if let Some(port) = actor_id.port() {
        format!(":{}", port)
      } else {
        "".to_string()
      },
    );
    Ok(Url::parse(&url)?)
  }

  fn get_outbox_url(&self) -> Result<Url, ParseError> {
    Url::parse(&format!("{}/outbox", &self.actor_id_str()))
  }

  fn get_followers_url(&self) -> Result<Url, ParseError> {
    Url::parse(&format!("{}/followers", &self.actor_id_str()))
  }

  fn get_following_url(&self) -> String {
    format!("{}/following", &self.actor_id_str())
  }

  fn get_liked_url(&self) -> String {
    format!("{}/liked", &self.actor_id_str())
  }

  fn get_public_key_ext(&self) -> Result<PublicKeyExtension, LemmyError> {
    Ok(
      PublicKey {
        id: format!("{}#main-key", self.actor_id_str()),
        owner: self.actor_id_str(),
        public_key_pem: self.public_key().context(location_info!())?,
      }
      .to_ext(),
    )
  }
}

pub async fn fetch_webfinger_url(
  mention: &MentionData,
  client: &Client,
) -> Result<Url, LemmyError> {
  let fetch_url = format!(
    "{}://{}/.well-known/webfinger?resource=acct:{}@{}",
    get_apub_protocol_string(),
    mention.domain,
    mention.name,
    mention.domain
  );
  debug!("Fetching webfinger url: {}", &fetch_url);

  let mut response = retry(|| client.get(&fetch_url).send()).await?;

  let res: WebFingerResponse = response
    .json()
    .await
    .map_err(|e| RecvError(e.to_string()))?;

  let link = res
    .links
    .iter()
    .find(|l| l.type_.eq(&Some("application/activity+json".to_string())))
    .ok_or_else(|| anyhow!("No application/activity+json link found."))?;
  link
    .href
    .to_owned()
    .map(|u| Url::parse(&u))
    .transpose()?
    .ok_or_else(|| anyhow!("No href found.").into())
}

pub async fn insert_activity<T>(
  user_id: i32,
  data: T,
  local: bool,
  pool: &DbPool,
) -> Result<(), LemmyError>
where
  T: Serialize + std::fmt::Debug + Send + 'static,
{
  blocking(pool, move |conn| {
    do_insert_activity(conn, user_id, &data, local)
  })
  .await??;
  Ok(())
}
