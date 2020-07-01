import { Component, linkEvent } from 'inferno';
import { Link } from 'inferno-router';
import { Subscription } from 'rxjs';
import { retryWhen, delay, take } from 'rxjs/operators';
import {
  UserOperation,
  Post,
  Comment,
  CommunityUser,
  GetUserDetailsForm,
  SortType,
  ListingType,
  UserDetailsResponse,
  UserView,
  CommentResponse,
  UserSettingsForm,
  LoginResponse,
  BanUserResponse,
  AddAdminResponse,
  DeleteAccountForm,
  PostResponse,
  WebSocketJsonResponse,
} from '../interfaces';
import { WebSocketService, UserService } from '../services';
import {
  wsJsonToRes,
  fetchLimit,
  routeSortTypeToEnum,
  capitalizeFirstLetter,
  themes,
  setTheme,
  languages,
  showAvatars,
  toast,
  editCommentRes,
  saveCommentRes,
  createCommentLikeRes,
  createPostLikeFindRes,
  commentsToFlatNodes,
  setupTippy,
} from '../utils';
import { PostListing } from './post-listing';
import { UserListing } from './user-listing';
import { SortSelect } from './sort-select';
import { ListingTypeSelect } from './listing-type-select';
import { CommentNodes } from './comment-nodes';
import { MomentTime } from './moment-time';
import { i18n } from '../i18next';

enum View {
  Overview,
  Comments,
  Posts,
  Saved,
}

interface UserState {
  user: UserView;
  user_id: number;
  username: string;
  follows: Array<CommunityUser>;
  moderates: Array<CommunityUser>;
  comments: Array<Comment>;
  posts: Array<Post>;
  saved?: Array<Post>;
  admins: Array<UserView>;
  view: View;
  sort: SortType;
  page: number;
  loading: boolean;
  avatarLoading: boolean;
  userSettingsForm: UserSettingsForm;
  userSettingsLoading: boolean;
  deleteAccountLoading: boolean;
  deleteAccountShowConfirm: boolean;
  deleteAccountForm: DeleteAccountForm;
}

export class User extends Component<any, UserState> {
  private subscription: Subscription;
  private emptyState: UserState = {
    user: {
      id: null,
      name: null,
      published: null,
      number_of_posts: null,
      post_score: null,
      number_of_comments: null,
      comment_score: null,
      banned: null,
      avatar: null,
      show_avatars: null,
      send_notifications_to_email: null,
      actor_id: null,
      local: null,
    },
    user_id: null,
    username: null,
    follows: [],
    moderates: [],
    comments: [],
    posts: [],
    admins: [],
    loading: true,
    avatarLoading: false,
    view: this.getViewFromProps(this.props),
    sort: this.getSortTypeFromProps(this.props),
    page: this.getPageFromProps(this.props),
    userSettingsForm: {
      show_nsfw: null,
      theme: null,
      default_sort_type: null,
      default_listing_type: null,
      lang: null,
      show_avatars: null,
      send_notifications_to_email: null,
      auth: null,
    },
    userSettingsLoading: null,
    deleteAccountLoading: null,
    deleteAccountShowConfirm: false,
    deleteAccountForm: {
      password: null,
    },
  };

  constructor(props: any, context: any) {
    super(props, context);

    this.state = this.emptyState;
    this.handleSortChange = this.handleSortChange.bind(this);
    this.handleUserSettingsSortTypeChange = this.handleUserSettingsSortTypeChange.bind(
      this
    );
    this.handleUserSettingsListingTypeChange = this.handleUserSettingsListingTypeChange.bind(
      this
    );

    this.state.user_id = Number(this.props.match.params.id);
    this.state.username = this.props.match.params.username;

    this.subscription = WebSocketService.Instance.subject
      .pipe(retryWhen(errors => errors.pipe(delay(3000), take(10))))
      .subscribe(
        msg => this.parseMessage(msg),
        err => console.error(err),
        () => console.log('complete')
      );

    this.refetch();
  }

  get isCurrentUser() {
    return (
      UserService.Instance.user &&
      UserService.Instance.user.id == this.state.user.id
    );
  }

  getViewFromProps(props: any): View {
    return props.match.params.view
      ? View[capitalizeFirstLetter(props.match.params.view)]
      : View.Overview;
  }

  getSortTypeFromProps(props: any): SortType {
    return props.match.params.sort
      ? routeSortTypeToEnum(props.match.params.sort)
      : SortType.New;
  }

  getPageFromProps(props: any): number {
    return props.match.params.page ? Number(props.match.params.page) : 1;
  }

  componentWillUnmount() {
    this.subscription.unsubscribe();
  }

  // Necessary for back button for some reason
  componentWillReceiveProps(nextProps: any) {
    if (
      nextProps.history.action == 'POP' ||
      nextProps.history.action == 'PUSH'
    ) {
      this.state.view = this.getViewFromProps(nextProps);
      this.state.sort = this.getSortTypeFromProps(nextProps);
      this.state.page = this.getPageFromProps(nextProps);
      this.setState(this.state);
      this.refetch();
    }
  }

  componentDidUpdate(lastProps: any, _lastState: UserState, _snapshot: any) {
    // Necessary if you are on a post and you click another post (same route)
    if (
      lastProps.location.pathname.split('/')[2] !==
      lastProps.history.location.pathname.split('/')[2]
    ) {
      // Couldnt get a refresh working. This does for now.
      location.reload();
    }
  }

  render() {
    return (
      <div class="container">
        {this.state.loading ? (
          <h5>
            <svg class="icon icon-spinner spin">
              <use xlinkHref="#icon-spinner"></use>
            </svg>
          </h5>
        ) : (
          <div class="row">
            <div class="col-12 col-md-8">
              <h5>
                {this.state.user.avatar && showAvatars() && (
                  <img
                    height="80"
                    width="80"
                    src={this.state.user.avatar}
                    class="rounded-circle mr-2"
                  />
                )}
                <span>/u/{this.state.user.name}</span>
              </h5>
              {this.selects()}
              {this.state.view == View.Overview && this.overview()}
              {this.state.view == View.Comments && this.comments()}
              {this.state.view == View.Posts && this.posts()}
              {this.state.view == View.Saved && this.overview()}
              {this.paginator()}
            </div>
            <div class="col-12 col-md-4">
              {this.userInfo()}
              {this.isCurrentUser && this.userSettings()}
              {this.moderates()}
              {this.follows()}
            </div>
          </div>
        )}
      </div>
    );
  }

  viewRadios() {
    return (
      <div class="btn-group btn-group-toggle">
        <label
          className={`btn btn-sm btn-secondary pointer btn-outline-light
            ${this.state.view == View.Overview && 'active'}
          `}
        >
          <input
            type="radio"
            value={View.Overview}
            checked={this.state.view == View.Overview}
            onChange={linkEvent(this, this.handleViewChange)}
          />
          {i18n.t('overview')}
        </label>
        <label
          className={`btn btn-sm btn-secondary pointer btn-outline-light
            ${this.state.view == View.Comments && 'active'}
          `}
        >
          <input
            type="radio"
            value={View.Comments}
            checked={this.state.view == View.Comments}
            onChange={linkEvent(this, this.handleViewChange)}
          />
          {i18n.t('comments')}
        </label>
        <label
          className={`btn btn-sm btn-secondary pointer btn-outline-light
            ${this.state.view == View.Posts && 'active'}
          `}
        >
          <input
            type="radio"
            value={View.Posts}
            checked={this.state.view == View.Posts}
            onChange={linkEvent(this, this.handleViewChange)}
          />
          {i18n.t('posts')}
        </label>
        <label
          className={`btn btn-sm btn-secondary pointer btn-outline-light
            ${this.state.view == View.Saved && 'active'}
          `}
        >
          <input
            type="radio"
            value={View.Saved}
            checked={this.state.view == View.Saved}
            onChange={linkEvent(this, this.handleViewChange)}
          />
          {i18n.t('saved')}
        </label>
      </div>
    );
  }

  selects() {
    return (
      <div className="mb-2">
        <span class="mr-3">{this.viewRadios()}</span>
        <SortSelect
          sort={this.state.sort}
          onChange={this.handleSortChange}
          hideHot
        />
        <a
          href={`/feeds/u/${this.state.username}.xml?sort=${
            SortType[this.state.sort]
          }`}
          target="_blank"
          rel="noopener"
          title="RSS"
        >
          <svg class="icon mx-2 text-muted small">
            <use xlinkHref="#icon-rss">#</use>
          </svg>
        </a>
      </div>
    );
  }

  overview() {
    let combined: Array<{ type_: string; data: Comment | Post }> = [];
    let comments = this.state.comments.map(e => {
      return { type_: 'comments', data: e };
    });
    let posts = this.state.posts.map(e => {
      return { type_: 'posts', data: e };
    });

    combined.push(...comments);
    combined.push(...posts);

    // Sort it
    if (this.state.sort == SortType.New) {
      combined.sort((a, b) => b.data.published.localeCompare(a.data.published));
    } else {
      combined.sort((a, b) => b.data.score - a.data.score);
    }

    return (
      <div>
        {combined.map(i => (
          <div>
            {i.type_ == 'posts' ? (
              <PostListing
                post={i.data as Post}
                admins={this.state.admins}
                showCommunity
              />
            ) : (
              <CommentNodes
                nodes={[{ comment: i.data as Comment }]}
                admins={this.state.admins}
                noIndent
                showContext
              />
            )}
          </div>
        ))}
      </div>
    );
  }

  comments() {
    return (
      <div>
        <CommentNodes
          nodes={commentsToFlatNodes(this.state.comments)}
          admins={this.state.admins}
          noIndent
          showContext
        />
      </div>
    );
  }

  posts() {
    return (
      <div>
        {this.state.posts.map(post => (
          <PostListing post={post} admins={this.state.admins} showCommunity />
        ))}
      </div>
    );
  }

  userInfo() {
    let user = this.state.user;
    return (
      <div>
        <div class="card border-secondary mb-3">
          <div class="card-body">
            <h5>
              <ul class="list-inline mb-0">
                <li className="list-inline-item">
                  <UserListing user={user} realLink />
                </li>
                {user.banned && (
                  <li className="list-inline-item badge badge-danger">
                    {i18n.t('banned')}
                  </li>
                )}
              </ul>
            </h5>
            <div>
              {i18n.t('joined')} <MomentTime data={user} showAgo />
            </div>
            <div class="table-responsive mt-1">
              <table class="table table-bordered table-sm mt-2 mb-0">
                {/*
                <tr>
                  <td class="text-center" colSpan={2}>
                    {i18n.t('number_of_points', {
                      count: user.post_score + user.comment_score,
                    })}
                  </td>
                </tr>
                */}
                <tr>
                  {/* 
                  <td>
                    {i18n.t('number_of_points', { count: user.post_score })}
                  </td>
                  */}
                  <td>
                    {i18n.t('number_of_posts', { count: user.number_of_posts })}
                  </td>
                  {/* 
                </tr>
                <tr>
                  <td>
                    {i18n.t('number_of_points', { count: user.comment_score })}
                  </td>
                  */}
                  <td>
                    {i18n.t('number_of_comments', {
                      count: user.number_of_comments,
                    })}
                  </td>
                </tr>
              </table>
            </div>
            {this.isCurrentUser ? (
              <button
                class="btn btn-block btn-secondary mt-3"
                onClick={linkEvent(this, this.handleLogoutClick)}
              >
                {i18n.t('logout')}
              </button>
            ) : (
              <>
                <a
                  className={`btn btn-block btn-secondary mt-3 ${
                    !this.state.user.matrix_user_id && 'disabled'
                  }`}
                  target="_blank"
                  rel="noopener"
                  href={`https://matrix.to/#/${this.state.user.matrix_user_id}`}
                >
                  {i18n.t('send_secure_message')}
                </a>
                <Link
                  class="btn btn-block btn-secondary mt-3"
                  to={`/create_private_message?recipient_id=${this.state.user.id}`}
                >
                  {i18n.t('send_message')}
                </Link>
              </>
            )}
          </div>
        </div>
      </div>
    );
  }

  userSettings() {
    return (
      <div>
        <div class="card border-secondary mb-3">
          <div class="card-body">
            <h5>{i18n.t('settings')}</h5>
            <form onSubmit={linkEvent(this, this.handleUserSettingsSubmit)}>
              <div class="form-group">
                <label>{i18n.t('avatar')}</label>
                <form class="d-inline">
                  <label
                    htmlFor="file-upload"
                    class="pointer ml-4 text-muted small font-weight-bold"
                  >
                    {!this.state.userSettingsForm.avatar ? (
                      <span class="btn btn-sm btn-secondary">
                        {i18n.t('upload_avatar')}
                      </span>
                    ) : (
                      <img
                        height="80"
                        width="80"
                        src={this.state.userSettingsForm.avatar}
                        class="rounded-circle"
                      />
                    )}
                  </label>
                  <input
                    id="file-upload"
                    type="file"
                    accept="image/*,video/*"
                    name="file"
                    class="d-none"
                    disabled={!UserService.Instance.user}
                    onChange={linkEvent(this, this.handleImageUpload)}
                  />
                </form>
              </div>
              <div class="form-group">
                <label>{i18n.t('language')}</label>
                <select
                  value={this.state.userSettingsForm.lang}
                  onChange={linkEvent(this, this.handleUserSettingsLangChange)}
                  class="ml-2 custom-select custom-select-sm w-auto"
                >
                  <option disabled>{i18n.t('language')}</option>
                  <option value="browser">{i18n.t('browser_default')}</option>
                  <option disabled>──</option>
                  {languages.map(lang => (
                    <option value={lang.code}>{lang.name}</option>
                  ))}
                </select>
              </div>
              <div class="form-group">
                <label>{i18n.t('theme')}</label>
                <select
                  value={this.state.userSettingsForm.theme}
                  onChange={linkEvent(this, this.handleUserSettingsThemeChange)}
                  class="ml-2 custom-select custom-select-sm w-auto"
                >
                  <option disabled>{i18n.t('theme')}</option>
                  {themes.map(theme => (
                    <option value={theme}>{theme}</option>
                  ))}
                </select>
              </div>
              <form className="form-group">
                <label>
                  <div class="mr-2">{i18n.t('sort_type')}</div>
                </label>
                <ListingTypeSelect
                  type_={this.state.userSettingsForm.default_listing_type}
                  onChange={this.handleUserSettingsListingTypeChange}
                />
              </form>
              <form className="form-group">
                <label>
                  <div class="mr-2">{i18n.t('type')}</div>
                </label>
                <SortSelect
                  sort={this.state.userSettingsForm.default_sort_type}
                  onChange={this.handleUserSettingsSortTypeChange}
                />
              </form>
              <div class="form-group row">
                <label class="col-lg-3 col-form-label" htmlFor="user-email">
                  {i18n.t('email')}
                </label>
                <div class="col-lg-9">
                  <input
                    type="email"
                    id="user-email"
                    class="form-control"
                    placeholder={i18n.t('optional')}
                    value={this.state.userSettingsForm.email}
                    onInput={linkEvent(
                      this,
                      this.handleUserSettingsEmailChange
                    )}
                    minLength={3}
                  />
                </div>
              </div>
              <div class="form-group row">
                <label class="col-lg-5 col-form-label">
                  <a
                    href="https://about.riot.im/"
                    target="_blank"
                    rel="noopener"
                  >
                    {i18n.t('matrix_user_id')}
                  </a>
                </label>
                <div class="col-lg-7">
                  <input
                    type="text"
                    class="form-control"
                    placeholder="@user:example.com"
                    value={this.state.userSettingsForm.matrix_user_id}
                    onInput={linkEvent(
                      this,
                      this.handleUserSettingsMatrixUserIdChange
                    )}
                    minLength={3}
                  />
                </div>
              </div>
              <div class="form-group row">
                <label class="col-lg-5 col-form-label" htmlFor="user-password">
                  {i18n.t('new_password')}
                </label>
                <div class="col-lg-7">
                  <input
                    type="password"
                    id="user-password"
                    class="form-control"
                    value={this.state.userSettingsForm.new_password}
                    autoComplete="new-password"
                    onInput={linkEvent(
                      this,
                      this.handleUserSettingsNewPasswordChange
                    )}
                  />
                </div>
              </div>
              <div class="form-group row">
                <label
                  class="col-lg-5 col-form-label"
                  htmlFor="user-verify-password"
                >
                  {i18n.t('verify_password')}
                </label>
                <div class="col-lg-7">
                  <input
                    type="password"
                    id="user-verify-password"
                    class="form-control"
                    value={this.state.userSettingsForm.new_password_verify}
                    autoComplete="new-password"
                    onInput={linkEvent(
                      this,
                      this.handleUserSettingsNewPasswordVerifyChange
                    )}
                  />
                </div>
              </div>
              <div class="form-group row">
                <label
                  class="col-lg-5 col-form-label"
                  htmlFor="user-old-password"
                >
                  {i18n.t('old_password')}
                </label>
                <div class="col-lg-7">
                  <input
                    type="password"
                    id="user-old-password"
                    class="form-control"
                    value={this.state.userSettingsForm.old_password}
                    autoComplete="new-password"
                    onInput={linkEvent(
                      this,
                      this.handleUserSettingsOldPasswordChange
                    )}
                  />
                </div>
              </div>
              {WebSocketService.Instance.site.enable_nsfw && (
                <div class="form-group">
                  <div class="form-check">
                    <input
                      class="form-check-input"
                      id="user-show-nsfw"
                      type="checkbox"
                      checked={this.state.userSettingsForm.show_nsfw}
                      onChange={linkEvent(
                        this,
                        this.handleUserSettingsShowNsfwChange
                      )}
                    />
                    <label class="form-check-label" htmlFor="user-show-nsfw">
                      {i18n.t('show_nsfw')}
                    </label>
                  </div>
                </div>
              )}
              <div class="form-group">
                <div class="form-check">
                  <input
                    class="form-check-input"
                    id="user-show-avatars"
                    type="checkbox"
                    checked={this.state.userSettingsForm.show_avatars}
                    onChange={linkEvent(
                      this,
                      this.handleUserSettingsShowAvatarsChange
                    )}
                  />
                  <label class="form-check-label" htmlFor="user-show-avatars">
                    {i18n.t('show_avatars')}
                  </label>
                </div>
              </div>
              <div class="form-group">
                <div class="form-check">
                  <input
                    class="form-check-input"
                    id="user-send-notifications-to-email"
                    type="checkbox"
                    disabled={!this.state.user.email}
                    checked={
                      this.state.userSettingsForm.send_notifications_to_email
                    }
                    onChange={linkEvent(
                      this,
                      this.handleUserSettingsSendNotificationsToEmailChange
                    )}
                  />
                  <label
                    class="form-check-label"
                    htmlFor="user-send-notifications-to-email"
                  >
                    {i18n.t('send_notifications_to_email')}
                  </label>
                </div>
              </div>
              <div class="form-group">
                <button type="submit" class="btn btn-block btn-secondary mr-4">
                  {this.state.userSettingsLoading ? (
                    <svg class="icon icon-spinner spin">
                      <use xlinkHref="#icon-spinner"></use>
                    </svg>
                  ) : (
                    capitalizeFirstLetter(i18n.t('save'))
                  )}
                </button>
              </div>
              <hr />
              <div class="form-group mb-0">
                <button
                  class="btn btn-block btn-danger"
                  onClick={linkEvent(
                    this,
                    this.handleDeleteAccountShowConfirmToggle
                  )}
                >
                  {i18n.t('delete_account')}
                </button>
                {this.state.deleteAccountShowConfirm && (
                  <>
                    <div class="my-2 alert alert-danger" role="alert">
                      {i18n.t('delete_account_confirm')}
                    </div>
                    <input
                      type="password"
                      value={this.state.deleteAccountForm.password}
                      autoComplete="new-password"
                      onInput={linkEvent(
                        this,
                        this.handleDeleteAccountPasswordChange
                      )}
                      class="form-control my-2"
                    />
                    <button
                      class="btn btn-danger mr-4"
                      disabled={!this.state.deleteAccountForm.password}
                      onClick={linkEvent(this, this.handleDeleteAccount)}
                    >
                      {this.state.deleteAccountLoading ? (
                        <svg class="icon icon-spinner spin">
                          <use xlinkHref="#icon-spinner"></use>
                        </svg>
                      ) : (
                        capitalizeFirstLetter(i18n.t('delete'))
                      )}
                    </button>
                    <button
                      class="btn btn-secondary"
                      onClick={linkEvent(
                        this,
                        this.handleDeleteAccountShowConfirmToggle
                      )}
                    >
                      {i18n.t('cancel')}
                    </button>
                  </>
                )}
              </div>
            </form>
          </div>
        </div>
      </div>
    );
  }

  moderates() {
    return (
      <div>
        {this.state.moderates.length > 0 && (
          <div class="card border-secondary mb-3">
            <div class="card-body">
              <h5>{i18n.t('moderates')}</h5>
              <ul class="list-unstyled mb-0">
                {this.state.moderates.map(community => (
                  <li>
                    <Link to={`/c/${community.community_name}`}>
                      {community.community_name}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </div>
    );
  }

  follows() {
    return (
      <div>
        {this.state.follows.length > 0 && (
          <div class="card border-secondary mb-3">
            <div class="card-body">
              <h5>{i18n.t('subscribed')}</h5>
              <ul class="list-unstyled mb-0">
                {this.state.follows.map(community => (
                  <li>
                    <Link to={`/c/${community.community_name}`}>
                      {community.community_name}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </div>
    );
  }

  paginator() {
    return (
      <div class="my-2">
        {this.state.page > 1 && (
          <button
            class="btn btn-sm btn-secondary mr-1"
            onClick={linkEvent(this, this.prevPage)}
          >
            {i18n.t('prev')}
          </button>
        )}
        <button
          class="btn btn-sm btn-secondary"
          onClick={linkEvent(this, this.nextPage)}
        >
          {i18n.t('next')}
        </button>
      </div>
    );
  }

  updateUrl() {
    let viewStr = View[this.state.view].toLowerCase();
    let sortStr = SortType[this.state.sort].toLowerCase();
    this.props.history.push(
      `/u/${this.state.user.name}/view/${viewStr}/sort/${sortStr}/page/${this.state.page}`
    );
  }

  nextPage(i: User) {
    i.state.page++;
    i.setState(i.state);
    i.updateUrl();
    i.refetch();
  }

  prevPage(i: User) {
    i.state.page--;
    i.setState(i.state);
    i.updateUrl();
    i.refetch();
  }

  refetch() {
    let form: GetUserDetailsForm = {
      user_id: this.state.user_id,
      username: this.state.username,
      sort: SortType[this.state.sort],
      saved_only: this.state.view == View.Saved,
      page: this.state.page,
      limit: fetchLimit,
    };
    WebSocketService.Instance.getUserDetails(form);
  }

  handleSortChange(val: SortType) {
    this.state.sort = val;
    this.state.page = 1;
    this.setState(this.state);
    this.updateUrl();
    this.refetch();
  }

  handleViewChange(i: User, event: any) {
    i.state.view = Number(event.target.value);
    i.state.page = 1;
    i.setState(i.state);
    i.updateUrl();
    i.refetch();
  }

  handleUserSettingsShowNsfwChange(i: User, event: any) {
    i.state.userSettingsForm.show_nsfw = event.target.checked;
    i.setState(i.state);
  }

  handleUserSettingsShowAvatarsChange(i: User, event: any) {
    i.state.userSettingsForm.show_avatars = event.target.checked;
    UserService.Instance.user.show_avatars = event.target.checked; // Just for instant updates
    i.setState(i.state);
  }

  handleUserSettingsSendNotificationsToEmailChange(i: User, event: any) {
    i.state.userSettingsForm.send_notifications_to_email = event.target.checked;
    i.setState(i.state);
  }

  handleUserSettingsThemeChange(i: User, event: any) {
    i.state.userSettingsForm.theme = event.target.value;
    setTheme(event.target.value, true);
    i.setState(i.state);
  }

  handleUserSettingsLangChange(i: User, event: any) {
    i.state.userSettingsForm.lang = event.target.value;
    i18n.changeLanguage(i.state.userSettingsForm.lang);
    i.setState(i.state);
  }

  handleUserSettingsSortTypeChange(val: SortType) {
    this.state.userSettingsForm.default_sort_type = val;
    this.setState(this.state);
  }

  handleUserSettingsListingTypeChange(val: ListingType) {
    this.state.userSettingsForm.default_listing_type = val;
    this.setState(this.state);
  }

  handleUserSettingsEmailChange(i: User, event: any) {
    i.state.userSettingsForm.email = event.target.value;
    if (i.state.userSettingsForm.email == '' && !i.state.user.email) {
      i.state.userSettingsForm.email = undefined;
    }
    i.setState(i.state);
  }

  handleUserSettingsMatrixUserIdChange(i: User, event: any) {
    i.state.userSettingsForm.matrix_user_id = event.target.value;
    if (
      i.state.userSettingsForm.matrix_user_id == '' &&
      !i.state.user.matrix_user_id
    ) {
      i.state.userSettingsForm.matrix_user_id = undefined;
    }
    i.setState(i.state);
  }

  handleUserSettingsNewPasswordChange(i: User, event: any) {
    i.state.userSettingsForm.new_password = event.target.value;
    if (i.state.userSettingsForm.new_password == '') {
      i.state.userSettingsForm.new_password = undefined;
    }
    i.setState(i.state);
  }

  handleUserSettingsNewPasswordVerifyChange(i: User, event: any) {
    i.state.userSettingsForm.new_password_verify = event.target.value;
    if (i.state.userSettingsForm.new_password_verify == '') {
      i.state.userSettingsForm.new_password_verify = undefined;
    }
    i.setState(i.state);
  }

  handleUserSettingsOldPasswordChange(i: User, event: any) {
    i.state.userSettingsForm.old_password = event.target.value;
    if (i.state.userSettingsForm.old_password == '') {
      i.state.userSettingsForm.old_password = undefined;
    }
    i.setState(i.state);
  }

  handleImageUpload(i: User, event: any) {
    event.preventDefault();
    let file = event.target.files[0];
    const imageUploadUrl = `/pictrs/image`;
    const formData = new FormData();
    formData.append('images[]', file);

    i.state.avatarLoading = true;
    i.setState(i.state);

    fetch(imageUploadUrl, {
      method: 'POST',
      body: formData,
    })
      .then(res => res.json())
      .then(res => {
        console.log('pictrs upload:');
        console.log(res);
        if (res.msg == 'ok') {
          let hash = res.files[0].file;
          let url = `${window.location.origin}/pictrs/image/${hash}`;
          i.state.userSettingsForm.avatar = url;
          i.state.avatarLoading = false;
          i.setState(i.state);
        } else {
          i.state.avatarLoading = false;
          i.setState(i.state);
          toast(JSON.stringify(res), 'danger');
        }
      })
      .catch(error => {
        i.state.avatarLoading = false;
        i.setState(i.state);
        toast(error, 'danger');
      });
  }

  handleUserSettingsSubmit(i: User, event: any) {
    event.preventDefault();
    i.state.userSettingsLoading = true;
    i.setState(i.state);

    WebSocketService.Instance.saveUserSettings(i.state.userSettingsForm);
  }

  handleDeleteAccountShowConfirmToggle(i: User, event: any) {
    event.preventDefault();
    i.state.deleteAccountShowConfirm = !i.state.deleteAccountShowConfirm;
    i.setState(i.state);
  }

  handleDeleteAccountPasswordChange(i: User, event: any) {
    i.state.deleteAccountForm.password = event.target.value;
    i.setState(i.state);
  }

  handleLogoutClick(i: User) {
    UserService.Instance.logout();
    i.context.router.history.push('/');
  }

  handleDeleteAccount(i: User, event: any) {
    event.preventDefault();
    i.state.deleteAccountLoading = true;
    i.setState(i.state);

    WebSocketService.Instance.deleteAccount(i.state.deleteAccountForm);
  }

  parseMessage(msg: WebSocketJsonResponse) {
    console.log(msg);
    let res = wsJsonToRes(msg);
    if (msg.error) {
      toast(i18n.t(msg.error), 'danger');
      this.state.deleteAccountLoading = false;
      this.state.avatarLoading = false;
      this.state.userSettingsLoading = false;
      if (msg.error == 'couldnt_find_that_username_or_email') {
        this.context.router.history.push('/');
      }
      this.setState(this.state);
      return;
    } else if (msg.reconnect) {
      this.refetch();
    } else if (res.op == UserOperation.GetUserDetails) {
      let data = res.data as UserDetailsResponse;
      this.state.user = data.user;
      this.state.comments = data.comments;
      this.state.follows = data.follows;
      this.state.moderates = data.moderates;
      this.state.posts = data.posts;
      this.state.admins = data.admins;
      this.state.loading = false;
      if (this.isCurrentUser) {
        this.state.userSettingsForm.show_nsfw =
          UserService.Instance.user.show_nsfw;
        this.state.userSettingsForm.theme = UserService.Instance.user.theme
          ? UserService.Instance.user.theme
          : 'darkly';
        this.state.userSettingsForm.default_sort_type =
          UserService.Instance.user.default_sort_type;
        this.state.userSettingsForm.default_listing_type =
          UserService.Instance.user.default_listing_type;
        this.state.userSettingsForm.lang = UserService.Instance.user.lang;
        this.state.userSettingsForm.avatar = UserService.Instance.user.avatar;
        this.state.userSettingsForm.email = this.state.user.email;
        this.state.userSettingsForm.send_notifications_to_email = this.state.user.send_notifications_to_email;
        this.state.userSettingsForm.show_avatars =
          UserService.Instance.user.show_avatars;
        this.state.userSettingsForm.matrix_user_id = this.state.user.matrix_user_id;
      }
      document.title = `/u/${this.state.user.name} - ${WebSocketService.Instance.site.name}`;
      window.scrollTo(0, 0);
      this.setState(this.state);
      setupTippy();
    } else if (res.op == UserOperation.EditComment) {
      let data = res.data as CommentResponse;
      editCommentRes(data, this.state.comments);
      this.setState(this.state);
    } else if (res.op == UserOperation.CreateComment) {
      let data = res.data as CommentResponse;
      if (
        UserService.Instance.user &&
        data.comment.creator_id == UserService.Instance.user.id
      ) {
        toast(i18n.t('reply_sent'));
      }
    } else if (res.op == UserOperation.SaveComment) {
      let data = res.data as CommentResponse;
      saveCommentRes(data, this.state.comments);
      this.setState(this.state);
    } else if (res.op == UserOperation.CreateCommentLike) {
      let data = res.data as CommentResponse;
      createCommentLikeRes(data, this.state.comments);
      this.setState(this.state);
    } else if (res.op == UserOperation.CreatePostLike) {
      let data = res.data as PostResponse;
      createPostLikeFindRes(data, this.state.posts);
      this.setState(this.state);
    } else if (res.op == UserOperation.BanUser) {
      let data = res.data as BanUserResponse;
      this.state.comments
        .filter(c => c.creator_id == data.user.id)
        .forEach(c => (c.banned = data.banned));
      this.state.posts
        .filter(c => c.creator_id == data.user.id)
        .forEach(c => (c.banned = data.banned));
      this.setState(this.state);
    } else if (res.op == UserOperation.AddAdmin) {
      let data = res.data as AddAdminResponse;
      this.state.admins = data.admins;
      this.setState(this.state);
    } else if (res.op == UserOperation.SaveUserSettings) {
      let data = res.data as LoginResponse;
      this.state = this.emptyState;
      this.state.userSettingsLoading = false;
      this.setState(this.state);
      UserService.Instance.login(data);
    } else if (res.op == UserOperation.DeleteAccount) {
      this.state.deleteAccountLoading = false;
      this.state.deleteAccountShowConfirm = false;
      this.setState(this.state);
      this.context.router.history.push('/');
    }
  }
}
