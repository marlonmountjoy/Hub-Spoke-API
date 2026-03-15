import os
import re
import secrets
import hashlib
from datetime import datetime, timezone, timedelta
from flask import Flask, request, send_from_directory
from flask_sqlalchemy import SQLAlchemy
from flask_restful import Api, Resource, reqparse, fields, marshal_with, abort
from flask_cors import CORS
from werkzeug.utils import secure_filename
from werkzeug.security import generate_password_hash, check_password_hash
from itsdangerous import URLSafeTimedSerializer, BadSignature, SignatureExpired

# -----------------------------
# App setup
# -----------------------------
app = Flask(__name__)

def _load_secret_key() -> str:
    secret = (os.environ.get("HUB_SECRET_KEY") or "").strip()
    if secret:
        return secret

    app_env = (os.environ.get("APP_ENV") or os.environ.get("FLASK_ENV") or "").strip().lower()
    allow_dev_fallback = (os.environ.get("ALLOW_DEV_SECRET_KEY") or "").strip() == "1"

    if app_env in {"development", "dev", "local"} or allow_dev_fallback:
        return "dev-unsafe-change-me"

    raise RuntimeError(
        "HUB_SECRET_KEY is required in production. "
        "Set it in the hubapi environment before starting the app."
    )

app.config["SECRET_KEY"] = _load_secret_key()

CORS(
    app,
    resources={
        r"/api/*": {
            "origins": [
                "https://hubspokeapi.xyz",
                "https://www.hubspokeapi.xyz",
            ]
        }
    },
    allow_headers=["Content-Type", "X-API-Key", "Authorization"],
    methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
)

@app.before_request
def _handle_preflight():
    if request.method == "OPTIONS":
        return "", 204

# Put the SQLite DB inside ./instance/
os.makedirs(app.instance_path, exist_ok=True)

# IMPORTANT: keep this as a dedicated auth DB to avoid schema mismatch/locks
db_path = os.path.join(app.instance_path, "database_auth.db")

app.config["SQLALCHEMY_DATABASE_URI"] = f"sqlite:///{db_path}"
app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False

# Folder for uploaded photos
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
STORAGE_DIR = os.path.join(BASE_DIR, "storage")
os.makedirs(STORAGE_DIR, exist_ok=True)

db = SQLAlchemy(app)
api = Api(app)

PHOTO_TOKEN_TTL_SECONDS = 60  # short-lived link tokens

# -----------------------------
# Helpers
# -----------------------------
def now_iso_utc() -> str:
    return datetime.now(timezone.utc).isoformat()

def hash_key(api_key: str) -> str:
    return hashlib.sha256(api_key.encode("utf-8")).hexdigest()


def parse_nullable_int(value):
    """Flask-RESTful reqparse helper.

    Frontends frequently send JSON null for optional integer fields.
    reqparse(type=int) will try int(None) and fail. This keeps optional
    ints truly optional.
    """

    if value is None:
        return None
    if isinstance(value, str) and value.strip() == "":
        return None
    return int(value)

def extract_api_key() -> str | None:
    """Extract an *API key* (public gateway credential).

    IMPORTANT: API keys come from X-API-Key header or ?api_key= query param.
    We intentionally do NOT treat Authorization: Bearer ... as 
    an API key.
    """
    h = request.headers.get("X-API-Key")
    if h:
        return h.strip() or None
    q = request.args.get("api_key")
    if q:
        return str(q).strip() or None
    return None

# -----------------------------
# Input validation / sanitization
# -----------------------------
SAFE_SHORT_RE = re.compile(r'^[A-Za-z0-9][A-Za-z0-9 .,_\-\//\+\(\)&\\\'":]{0,119}$')
SAFE_KEY_NAME_RE = re.compile(r'^[A-Za-z0-9][A-Za-z0-9 .,_\-\//\+\(\)&\\\'":]{0,63}$')
SAFE_USERNAME_RE = re.compile(r'^[A-Za-z0-9._-]{3,32}$')
TOOL_STATUSES = {"available","checked_out","needs_repair","missing","tagged_out"}
SAFE_MESSAGE_RE = re.compile(r'^[\x20-\x7E\t\r\n]{1,2000}$')

def _clean_text(val: str | None, *, field: str, max_len: int, allow_newlines: bool = False) -> str | None:
    if val is None:
        return None
    if not isinstance(val, str):
        val = str(val)
    # remove null bytes and normalize whitespace slightly
    val = val.replace("\x00", "")
    val = val.strip()
    if len(val) > max_len:
        abort(400, message=f"{field} is too long (max {max_len}).")
    if "<" in val or ">" in val or "`" in val:
        abort(400, message=f"{field} contains unsupported characters.")
    # drop other control chars
    cleaned = []
    for ch in val:
        code = ord(ch)
        if code < 32:
            if ch in ("\t",) or (allow_newlines and ch in ("\n", "\r")):
                cleaned.append(ch)
            continue
        cleaned.append(ch)
    return "".join(cleaned)

def validate_short_text(val: str | None, *, field: str, required: bool = False, max_len: int = 120) -> str | None:
    v = _clean_text(val, field=field, max_len=max_len, allow_newlines=False)
    if v is None or v == "":
        if required:
            abort(400, message=f"{field} is required.")
        return None
    if not SAFE_SHORT_RE.match(v):
        abort(400, message=f"{field} has unsupported characters.")
    return v

def validate_key_name(val: str | None) -> str:
    v = _clean_text(val, field="name", max_len=64, allow_newlines=False) or ""
    if not v:
        abort(400, message="name is required.")
    if not SAFE_KEY_NAME_RE.match(v):
        abort(400, message="name has unsupported characters.")
    return v

def validate_username(val: str | None) -> str:
    v = _clean_text(val, field="username", max_len=32, allow_newlines=False) or ""
    if not v:
        abort(400, message="username is required.")
    if not SAFE_USERNAME_RE.match(v):
        abort(400, message="username has unsupported characters.")
    return v

def validate_message(val: str | None) -> str:
    v = _clean_text(val, field="body", max_len=2000, allow_newlines=True) or ""
    if not v:
        abort(400, message="body is required.")
    if not SAFE_MESSAGE_RE.match(v):
        abort(400, message="body has unsupported characters.")
    return v


def extract_bearer_token() -> str | None:
    """Extract Authorization: Bearer <token>."""
    auth = request.headers.get("Authorization") or ""
    auth = auth.strip()
    if not auth:
        return None
    if not auth.lower().startswith("bearer "):
        return None
    token = auth.split(" ", 1)[1].strip()
    return token or None

def serializer() -> URLSafeTimedSerializer:
    return URLSafeTimedSerializer(app.config["SECRET_KEY"], salt="hub-access")

ACCESS_TOKEN_TTL_SECONDS = 60 * 60 * 6  # 6 hours

def make_access_token(user_id: int) -> str:
    return serializer().dumps({"uid": user_id})

def verify_access_token(token: str) -> int | None:
    try:
        data = serializer().loads(token, max_age=ACCESS_TOKEN_TTL_SECONDS)
        uid = int(data.get("uid"))
        return uid
    except (BadSignature, SignatureExpired, ValueError, TypeError):
        return None

def require_user(*, allow_api_key: bool = True, allow_bearer: bool = True):
    """Resolve the current user from either:
    - Authorization: Bearer <access_token> (preferred, password login), OR
    - X-API-Key / ?api_key= (public gateway)

    Order: Bearer first (if allowed), then API key (if allowed).
    """
    if allow_bearer:
        token = extract_bearer_token()
        if token:
            uid = verify_access_token(token)
            if uid:
                u = User.query.get(uid)
                if u:
                    return u

    if allow_api_key:
        api_key = extract_api_key()
        if api_key:
            h = hash_key(api_key)
            k = ApiKey.query.filter_by(key_hash=h, revoked=False).first()
            if not k:
                abort(401, message="Invalid API key")
            u = User.query.get(k.user_id)
            if not u:
                abort(401, message="Invalid API key user")
            return u

    abort(401, message="Unauthorized")

def try_user(*, allow_api_key: bool = True, allow_bearer: bool = True):
    """Like require_user, but returns None instead of aborting.

    This is critical for image <img src> requests, which don't carry Authorization
    headers, but may provide a signed token via query string.
    """
    if allow_bearer:
        token = extract_bearer_token()
        if token:
            uid = verify_access_token(token)
            if uid:
                u = User.query.get(uid)
                if u:
                    return u

    if allow_api_key:
        api_key = extract_api_key()
        if api_key:
            h = hash_key(api_key)
            k = ApiKey.query.filter_by(key_hash=h, revoked=False).first()
            if not k:
                return None
            u = User.query.get(k.user_id)
            return u

    return None

def require_photo_access(photo_id: int, token: str | None):
    """Return True if token grants access to photo_id, else False."""
    if not token:
        return False
    try:
        payload = serializer().loads(token, max_age=PHOTO_TOKEN_TTL_SECONDS)
        return int(payload.get("photo_id")) == int(photo_id)
    except Exception:
        return False

def make_photo_token(photo_id: int) -> str:
    return serializer().dumps({"photo_id": int(photo_id)})

# -----------------------------
# Models
# -----------------------------
class User(db.Model):
    __tablename__ = "users"
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(120), unique=True, nullable=False)
    password_hash = db.Column(db.String(255), nullable=False)
    created_at = db.Column(db.String(32), nullable=False)

class ApiKey(db.Model):
    __tablename__ = "api_keys"
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False)
    name = db.Column(db.String(120), nullable=False)
    key_hash = db.Column(db.String(64), nullable=False, unique=True)
    key_prefix = db.Column(db.String(12), nullable=False)
    created_at = db.Column(db.String(32), nullable=False)
    revoked = db.Column(db.Boolean, default=False)

class Message(db.Model):
    __tablename__ = "messages"
    id = db.Column(db.Integer, primary_key=True)
    sender_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False)
    recipient_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False)
    body = db.Column(db.Text, nullable=False)
    created_at = db.Column(db.String(32), nullable=False)

class Photo(db.Model):
    __tablename__ = "photos"
    id = db.Column(db.Integer, primary_key=True)
    owner_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False)
    filename = db.Column(db.String(255), nullable=False)
    original_name = db.Column(db.String(255), nullable=False)
    content_type = db.Column(db.String(80), nullable=False)
    size_bytes = db.Column(db.Integer, nullable=False)
    created_at = db.Column(db.String(32), nullable=False)

class Timer(db.Model):
    __tablename__ = "timers"
    id = db.Column(db.Integer, primary_key=True)
    owner_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False)
    name = db.Column(db.String(120), nullable=False)
    target_time_utc = db.Column(db.String(32), nullable=False)
    created_at = db.Column(db.String(32), nullable=False)
    updated_at = db.Column(db.String(32), nullable=False)

# -----------------------------
# Tool Inventory models (NEW)
# -----------------------------
class ToolGroup(db.Model):
    __tablename__ = "tool_groups"
    id = db.Column(db.Integer, primary_key=True)

    owner_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False)
    name = db.Column(db.String(120), nullable=False)
    description = db.Column(db.Text, nullable=True)
    created_at = db.Column(db.String(32), nullable=False)

class Tool(db.Model):
    __tablename__ = "tools"
    id = db.Column(db.Integer, primary_key=True)

    owner_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False)
    group_id = db.Column(db.Integer, db.ForeignKey("tool_groups.id"), nullable=True)

    name = db.Column(db.String(120), nullable=False)
    brand = db.Column(db.String(120), nullable=True)
    model = db.Column(db.String(120), nullable=True)
    location = db.Column(db.String(120), nullable=True)

    status = db.Column(db.String(40), nullable=False, default="available")
    notes = db.Column(db.Text, nullable=True)

    created_at = db.Column(db.String(32), nullable=False)
    updated_at = db.Column(db.String(32), nullable=False)

    @property
    def primary_photo_id(self):
        # Prefer explicit primary
        tp = (
            ToolPhoto.query.filter_by(owner_id=self.owner_id, tool_id=self.id, is_primary=True)
            .order_by(ToolPhoto.id.desc())
            .first()
        )
        if tp:
            return tp.photo_id

        # Else: newest attached
        tp2 = (
            ToolPhoto.query.filter_by(owner_id=self.owner_id, tool_id=self.id)
            .order_by(ToolPhoto.id.desc())
            .first()
        )
        return tp2.photo_id if tp2 else None

class ToolPhoto(db.Model):
    __tablename__ = "tool_photos"
    id = db.Column(db.Integer, primary_key=True)

    owner_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False)
    tool_id = db.Column(db.Integer, db.ForeignKey("tools.id"), nullable=False)
    photo_id = db.Column(db.Integer, db.ForeignKey("photos.id"), nullable=False)

    is_primary = db.Column(db.Boolean, default=False)
    created_at = db.Column(db.String(32), nullable=False)


def _existing_columns(table_name: str) -> set[str]:
    cols: set[str] = set()
    try:
        rows = db.session.execute(db.text(f"PRAGMA table_info({table_name})")).fetchall()
        for r in rows:
            # r: (cid, name, type, notnull, dflt_value, pk)
            cols.add(str(r[1]))
    except Exception:
        # Table likely doesn't exist yet.
        return set()
    return cols


def _add_column_if_missing(table: str, col: str, sql_type: str, *, default_sql: str | None = None):
    cols = _existing_columns(table)
    if not cols or col in cols:
        return
    ddl = f"ALTER TABLE {table} ADD COLUMN {col} {sql_type}"
    if default_sql is not None:
        ddl += f" DEFAULT {default_sql}"
    db.session.execute(db.text(ddl))


def ensure_schema():
    """Best-effort lightweight migration.

    This project has evolved (tools, photos, api keys). SQLite doesn't support
    many ALTER operations, but we *can* safely add missing columns.

    If you're running an older instance DB, this avoids 500s / schema mismatch
    during create tool, photo upload, and API key operations.
    """

    db.create_all()

    # Additive migrations only (safe):
    # api_keys
    _add_column_if_missing("api_keys", "revoked", "BOOLEAN", default_sql="0")
    _add_column_if_missing("api_keys", "key_prefix", "VARCHAR(12)")
    _add_column_if_missing("api_keys", "created_at", "VARCHAR(32)")
    _add_column_if_missing("api_keys", "name", "VARCHAR(120)")
    _add_column_if_missing("api_keys", "key_hash", "VARCHAR(64)")
    _add_column_if_missing("api_keys", "user_id", "INTEGER")

    # photos
    _add_column_if_missing("photos", "content_type", "VARCHAR(80)")
    _add_column_if_missing("photos", "size_bytes", "INTEGER")
    _add_column_if_missing("photos", "created_at", "VARCHAR(32)")
    _add_column_if_missing("photos", "original_name", "VARCHAR(255)")
    _add_column_if_missing("photos", "filename", "VARCHAR(255)")
    _add_column_if_missing("photos", "owner_id", "INTEGER")

    # tools
    _add_column_if_missing("tools", "owner_id", "INTEGER")
    _add_column_if_missing("tools", "group_id", "INTEGER")
    _add_column_if_missing("tools", "brand", "VARCHAR(120)")
    _add_column_if_missing("tools", "model", "VARCHAR(120)")
    _add_column_if_missing("tools", "location", "VARCHAR(120)")
    _add_column_if_missing("tools", "status", "VARCHAR(40)", default_sql="'available'")
    _add_column_if_missing("tools", "notes", "TEXT")
    _add_column_if_missing("tools", "created_at", "VARCHAR(32)")
    _add_column_if_missing("tools", "updated_at", "VARCHAR(32)")
    _add_column_if_missing("tools", "name", "VARCHAR(120)")

    # tool_groups
    _add_column_if_missing("tool_groups", "owner_id", "INTEGER")
    _add_column_if_missing("tool_groups", "name", "VARCHAR(120)")
    _add_column_if_missing("tool_groups", "description", "TEXT")
    _add_column_if_missing("tool_groups", "created_at", "VARCHAR(32)")

    # tool_photos
    _add_column_if_missing("tool_photos", "owner_id", "INTEGER")
    _add_column_if_missing("tool_photos", "tool_id", "INTEGER")
    _add_column_if_missing("tool_photos", "photo_id", "INTEGER")
    _add_column_if_missing("tool_photos", "is_primary", "BOOLEAN", default_sql="0")
    _add_column_if_missing("tool_photos", "created_at", "VARCHAR(32)")

    db.session.commit()


with app.app_context():
    ensure_schema()

# -----------------------------
# Parsers
# -----------------------------
user_parser = reqparse.RequestParser()
user_parser.add_argument("username", type=str, required=True, help="username is required")

auth_register_parser = reqparse.RequestParser()
auth_register_parser.add_argument("username", type=str, required=True, help="username is required")
auth_register_parser.add_argument("password", type=str, required=True, help="password is required")

auth_login_parser = reqparse.RequestParser()
auth_login_parser.add_argument("username", type=str, required=True, help="username is required")
auth_login_parser.add_argument("password", type=str, required=True, help="password is required")

auth_delete_parser = reqparse.RequestParser()
auth_delete_parser.add_argument("password", type=str, required=True, help="password is required")

api_key_create_parser = reqparse.RequestParser()
api_key_create_parser.add_argument("name", type=str, required=True, help="name is required")

message_parser = reqparse.RequestParser()
message_parser.add_argument("recipient_id", type=int, required=True, help="recipient_id is required")
message_parser.add_argument("body", type=str, required=True, help="body is required")

photo_upload_parser = reqparse.RequestParser()
# "file" comes from request.files, not reqparse.

timer_parser = reqparse.RequestParser()
timer_parser.add_argument("name", type=str, required=True, help="name is required")
timer_parser.add_argument("target_time_utc", type=str, required=True, help="target_time_utc is required")

timer_update_parser = reqparse.RequestParser()
timer_update_parser.add_argument("name", type=str, required=False)
timer_update_parser.add_argument("target_time_utc", type=str, required=False)

# Tool groups
tool_group_parser = reqparse.RequestParser()
tool_group_parser.add_argument("name", type=str, required=True, help="name is required")
tool_group_parser.add_argument("description", type=str, required=False)

# Tools
tool_parser = reqparse.RequestParser()
tool_parser.add_argument("group_id", type=parse_nullable_int, required=False)
tool_parser.add_argument("name", type=str, required=True, help="name is required")
tool_parser.add_argument("brand", type=str, required=False)
tool_parser.add_argument("model", type=str, required=False)
tool_parser.add_argument("location", type=str, required=False)
tool_parser.add_argument("status", type=str, required=False)
tool_parser.add_argument("notes", type=str, required=False)

tool_update_parser = reqparse.RequestParser()
tool_update_parser.add_argument("group_id", type=parse_nullable_int, required=False)
tool_update_parser.add_argument("name", type=str, required=False)
tool_update_parser.add_argument("brand", type=str, required=False)
tool_update_parser.add_argument("model", type=str, required=False)
tool_update_parser.add_argument("location", type=str, required=False)
tool_update_parser.add_argument("status", type=str, required=False)
tool_update_parser.add_argument("notes", type=str, required=False)

# Tool photos attach
tool_photo_attach_parser = reqparse.RequestParser()
tool_photo_attach_parser.add_argument("photo_id", type=int, required=True, help="photo_id is required")
tool_photo_attach_parser.add_argument("is_primary", type=bool, required=False)

# -----------------------------
# Field Marshalling
# -----------------------------
user_fields = {
    "id": fields.Integer,
    "username": fields.String,
    "created_at": fields.String,
}

api_key_fields = {
    "id": fields.Integer,
    "name": fields.String,
    "key_prefix": fields.String,
    "created_at": fields.String,
    "revoked": fields.Boolean,
}

message_fields = {
    "id": fields.Integer,
    "sender_id": fields.Integer,
    "recipient_id": fields.Integer,
    "body": fields.String,
    "created_at": fields.String,
}

photo_fields = {
    "id": fields.Integer,
    "owner_id": fields.Integer,
    "filename": fields.String,
    "original_name": fields.String,
    "content_type": fields.String,
    "size_bytes": fields.Integer,
    "created_at": fields.String,
}

timer_fields = {
    "id": fields.Integer,
    "owner_id": fields.Integer,
    "name": fields.String,
    "target_time_utc": fields.String,
    "created_at": fields.String,
    "updated_at": fields.String,
}

tool_group_fields = {
    "id": fields.Integer,
    "owner_id": fields.Integer,
    "name": fields.String,
    "description": fields.String,
    "created_at": fields.String,
}

tool_fields = {
    "id": fields.Integer,
    "owner_id": fields.Integer,
    "group_id": fields.Integer,
    "name": fields.String,
    "brand": fields.String,
    "model": fields.String,
    "location": fields.String,
    "status": fields.String,
    "notes": fields.String,
    "created_at": fields.String,
    "updated_at": fields.String,
    "primary_photo_id": fields.Integer,
}

tool_photo_fields = {
    "id": fields.Integer,
    "owner_id": fields.Integer,
    "tool_id": fields.Integer,
    "photo_id": fields.Integer,
    "is_primary": fields.Boolean,
    "created_at": fields.String,
}

# -----------------------------
# Resources
# -----------------------------
class Health(Resource):
    def get(self):
        return {"ok": True, "time_utc": now_iso_utc()}, 200

class Users(Resource):
    @marshal_with(user_fields)
    def get(self):
        require_user(allow_api_key=False, allow_bearer=True)
        # Only show usernames & ids; keep it simple
        return User.query.order_by(User.id.asc()).all(), 200

class AuthRegister(Resource):
    def post(self):
        args = auth_register_parser.parse_args()
        username = validate_username(args.get("username"))
        password = args.get("password") or ""

        if "\x00" in password:
            abort(400, message="password contains unsupported characters")
        if len(password) < 8 or len(password) > 128:
            abort(400, message="password must be 8-128 characters")

        if User.query.filter_by(username=username).first() is not None:
            abort(409, message="username already exists")

        u = User(
            username=username,
            password_hash=generate_password_hash(password),
            created_at=now_iso_utc(),
        )
        db.session.add(u)
        db.session.commit()

        return {"id": u.id, "username": u.username, "created_at": u.created_at}, 201

class AuthLogin(Resource):
    def post(self):
        args = auth_login_parser.parse_args()
        username = validate_username(args.get("username"))
        password = args.get("password") or ""

        u = User.query.filter_by(username=username).first()
        if u is None or not check_password_hash(u.password_hash, password):
            abort(401, message="Invalid username or password")

        token = make_access_token(u.id)
        return {"access_token": token, "expires_in": ACCESS_TOKEN_TTL_SECONDS}, 200

class AuthMe(Resource):
    @marshal_with(user_fields)
    def get(self):
        u = require_user(allow_api_key=False, allow_bearer=True)
        return u, 200

    def delete(self):
        me = require_user(allow_api_key=False, allow_bearer=True)
        args = auth_delete_parser.parse_args()
        password = args.get("password") or ""

        if "\x00" in password:
            abort(400, message="password contains unsupported characters")

        if not check_password_hash(me.password_hash, password):
            abort(401, message="Invalid password")

        owned_photos = Photo.query.filter_by(owner_id=me.id).all()
        owned_filenames = [p.filename for p in owned_photos if p.filename]

        try:
            ToolPhoto.query.filter_by(owner_id=me.id).delete(synchronize_session=False)
            Tool.query.filter_by(owner_id=me.id).delete(synchronize_session=False)
            ToolGroup.query.filter_by(owner_id=me.id).delete(synchronize_session=False)

            ApiKey.query.filter_by(user_id=me.id).delete(synchronize_session=False)
            Timer.query.filter_by(owner_id=me.id).delete(synchronize_session=False)
            Photo.query.filter_by(owner_id=me.id).delete(synchronize_session=False)

            Message.query.filter(
                (Message.sender_id == me.id) | (Message.recipient_id == me.id)
            ).delete(synchronize_session=False)

            db.session.delete(me)
            db.session.commit()
        except Exception:
            db.session.rollback()
            raise

        for filename in owned_filenames:
            try:
                os.remove(os.path.join(STORAGE_DIR, filename))
            except FileNotFoundError:
                pass
            except Exception:
                pass

        return {"ok": True, "message": "account deleted"}, 200

class ApiKeys(Resource):
    @marshal_with(api_key_fields)
    def get(self):
        u = require_user(allow_api_key=False, allow_bearer=True)
        return ApiKey.query.filter_by(user_id=u.id).order_by(ApiKey.id.desc()).all(), 200

    def post(self):
        u = require_user(allow_api_key=False, allow_bearer=True)
        args = api_key_create_parser.parse_args()
        name = validate_key_name(args.get("name"))

        api_key_plain = secrets.token_urlsafe(32)
        k = ApiKey(
            user_id=u.id,
            name=name,
            key_hash=hash_key(api_key_plain),
            key_prefix=api_key_plain[:10],
            created_at=now_iso_utc(),
            revoked=False,
        )
        db.session.add(k)
        db.session.commit()

        return {
            "ok": True,
            "id": k.id,
            "name": k.name,
            "key_prefix": k.key_prefix,
            "created_at": k.created_at,
            "api_key": api_key_plain,  # shown once
        }, 201

class ApiKeyRevoke(Resource):
    def delete(self, key_id: int):
        u = require_user(allow_api_key=False, allow_bearer=True)
        k = ApiKey.query.get(key_id)
        if k is None or k.user_id != u.id:
            abort(404, message="key not found")
        k.revoked = True
        db.session.commit()
        return {"ok": True}, 200

class Messages(Resource):
    @marshal_with(message_fields)
    def get(self):
        me = require_user()
        with_user_id = request.args.get("with_user_id", type=int)

        q = Message.query.filter(
            ((Message.sender_id == me.id) & (Message.recipient_id == with_user_id))
            | ((Message.sender_id == with_user_id) & (Message.recipient_id == me.id))
        ).order_by(Message.id.desc())

        return q.limit(200).all(), 200

    def post(self):
        me = require_user()
        args = message_parser.parse_args()

        if me.id == args["recipient_id"]:
            abort(400, message="cannot send to self")

        # Ensure recipient exists
        if User.query.get(args["recipient_id"]) is None:
            abort(404, message="recipient not found")

        body = validate_message(args.get("body"))

        msg = Message(
            sender_id=me.id,
            recipient_id=args["recipient_id"],
            body=body,
            created_at=now_iso_utc(),
        )
        db.session.add(msg)
        db.session.commit()
        return {"ok": True, "id": msg.id}, 201

class Photos(Resource):
    @marshal_with(photo_fields)
    def get(self):
        me = require_user()
        return Photo.query.filter_by(owner_id=me.id).order_by(Photo.id.desc()).all(), 200

class PhotoUpload(Resource):
    def post(self):
        me = require_user()

        if "file" not in request.files:
            abort(400, message="file is required")

        f = request.files["file"]
        if not f or not f.filename:
            abort(400, message="file is required")

        original = f.filename
        filename = secure_filename(original) or "upload"
        ext = os.path.splitext(filename)[1].lower()
        if ext not in [".png", ".jpg", ".jpeg", ".gif", ".webp"]:
            abort(400, message="unsupported file type")

        content_type = f.mimetype or "application/octet-stream"

        # Save
        rand = secrets.token_hex(8)
        stored = f"{int(datetime.now().timestamp())}_{rand}{ext}"
        path = os.path.join(STORAGE_DIR, stored)
        f.save(path)

        size = os.path.getsize(path)

        p = Photo(
            owner_id=me.id,
            filename=stored,
            original_name=original,
            content_type=content_type,
            size_bytes=size,
            created_at=now_iso_utc(),
        )
        db.session.add(p)
        db.session.commit()

        return {"ok": True, "id": p.id}, 201

class PhotoDelete(Resource):
    def delete(self, photo_id: int):
        me = require_user()
        p = Photo.query.get(photo_id)
        if p is None or p.owner_id != me.id:
            abort(404, message="photo not found")

        # Remove tool links pointing at this photo
        for tp in ToolPhoto.query.filter_by(owner_id=me.id, photo_id=p.id).all():
            db.session.delete(tp)

        # Delete file
        try:
            os.remove(os.path.join(STORAGE_DIR, p.filename))
        except FileNotFoundError:
            pass

        db.session.delete(p)
        db.session.commit()
        return {"ok": True}, 200

class PhotoToken(Resource):
    def post(self, photo_id: int):
        me = require_user()
        p = Photo.query.get(photo_id)
        if p is None or p.owner_id != me.id:
            abort(404, message="photo not found")

        t = make_photo_token(photo_id)
        return {"ok": True, "token": t, "ttl_seconds": PHOTO_TOKEN_TTL_SECONDS}, 200

class PhotoView(Resource):
    def get(self, photo_id: int):
        # NOTE: <img src> requests won't carry Authorization headers.
        # Allow either an authenticated user OR a valid signed token.
        me = try_user()
        p = Photo.query.get(photo_id)
        if p is None:
            abort(404, message="photo not found")

        # If authenticated owner, allow.
        if me and p.owner_id == me.id:
            return send_from_directory(STORAGE_DIR, p.filename, mimetype=p.content_type)

        # Otherwise, require token-only access.
        token = request.args.get("token")
        if not require_photo_access(photo_id, token):
            abort(401, message="Unauthorized")

        return send_from_directory(STORAGE_DIR, p.filename, mimetype=p.content_type)

class PhotoDownload(Resource):
    def get(self, photo_id: int):
        # Same access rules as PhotoView
        me = try_user()
        p = Photo.query.get(photo_id)
        if p is None:
            abort(404, message="photo not found")

        if me and p.owner_id == me.id:
            return send_from_directory(
                STORAGE_DIR,
                p.filename,
                mimetype=p.content_type,
                as_attachment=True,
                download_name=p.original_name,
            )

        token = request.args.get("token")
        if not require_photo_access(photo_id, token):
            abort(401, message="Unauthorized")

        return send_from_directory(
            STORAGE_DIR,
            p.filename,
            mimetype=p.content_type,
            as_attachment=True,
            download_name=p.original_name,
        )

class Timers(Resource):
    @marshal_with(timer_fields)
    def get(self):
        me = require_user()
        return Timer.query.filter_by(owner_id=me.id).order_by(Timer.id.desc()).all(), 200

    def post(self):
        me = require_user()
        args = timer_parser.parse_args()

        name = (args["name"] or "").strip()
        target = (args["target_time_utc"] or "").strip()
        if not name or not target:
            abort(400, message="name and target_time_utc are required")

        t = Timer(
            owner_id=me.id,
            name=name,
            target_time_utc=target,
            created_at=now_iso_utc(),
            updated_at=now_iso_utc(),
        )
        db.session.add(t)
        db.session.commit()
        return {"ok": True, "id": t.id}, 201

class TimerItem(Resource):
    @marshal_with(timer_fields)
    def get(self, timer_id: int):
        me = require_user()
        t = Timer.query.get(timer_id)
        if t is None or t.owner_id != me.id:
            abort(404, message="timer not found")
        return t, 200

    def patch(self, timer_id: int):
        me = require_user()
        t = Timer.query.get(timer_id)
        if t is None or t.owner_id != me.id:
            abort(404, message="timer not found")

        args = timer_update_parser.parse_args()
        if args.get("name"):
            t.name = args["name"].strip()
        if args.get("target_time_utc"):
            t.target_time_utc = args["target_time_utc"].strip()

        t.updated_at = now_iso_utc()
        db.session.commit()
        return {"ok": True}, 200

    def delete(self, timer_id: int):
        me = require_user()
        t = Timer.query.get(timer_id)
        if t is None or t.owner_id != me.id:
            abort(404, message="timer not found")
        db.session.delete(t)
        db.session.commit()
        return {"ok": True}, 200

class ToolGroups(Resource):
    @marshal_with(tool_group_fields)
    def get(self):
        me = require_user()
        return ToolGroup.query.filter_by(owner_id=me.id).order_by(ToolGroup.id.desc()).all(), 200

    def post(self):
        me = require_user()
        args = tool_group_parser.parse_args()

        name = validate_short_text(args.get("name"), field="name", required=True, max_len=120)

        desc = _clean_text(args.get("description"), field="description", max_len=500, allow_newlines=True)
        if desc == "":
            desc = None

        g = ToolGroup(
            owner_id=me.id,
            name=name,
            description=desc,
            created_at=now_iso_utc(),
        )
        db.session.add(g)
        db.session.commit()
        return {"ok": True, "id": g.id}, 201

class ToolGroupDelete(Resource):
    def delete(self, group_id: int):
        me = require_user()
        g = ToolGroup.query.get(group_id)
        if g is None or g.owner_id != me.id:
            abort(404, message="group not found")

        # Tools in this group become ungrouped
        for t in Tool.query.filter_by(owner_id=me.id, group_id=g.id).all():
            t.group_id = None
            t.updated_at = now_iso_utc()

        db.session.delete(g)
        db.session.commit()
        return {"ok": True}, 200

class Tools(Resource):
    @marshal_with(tool_fields)
    def get(self):
        me = require_user()
        q = Tool.query.filter_by(owner_id=me.id)

        group_id = request.args.get("group_id", type=int)
        status = request.args.get("status", type=str)
        search = request.args.get("q", type=str)

        if group_id is not None:
            q = q.filter_by(group_id=group_id)
        if status:
            q = q.filter_by(status=status)

        if search and search.strip():
            s = f"%{search.strip()}%"
            q = q.filter(
                (Tool.name.ilike(s))
                | (Tool.brand.ilike(s))
                | (Tool.model.ilike(s))
                | (Tool.location.ilike(s))
                | (Tool.notes.ilike(s))
            )

        return q.order_by(Tool.id.desc()).all(), 200

    def post(self):
        me = require_user()
        args = tool_parser.parse_args()

        name = validate_short_text(args.get("name"), field="name", required=True, max_len=120)
        brand = validate_short_text(args.get("brand"), field="brand", required=False, max_len=120)
        model = validate_short_text(args.get("model"), field="model", required=False, max_len=120)
        location = validate_short_text(args.get("location"), field="location", required=False, max_len=120)

        status = _clean_text(args.get("status") or "available", field="status", max_len=40, allow_newlines=False) or "available"
        if status not in TOOL_STATUSES:
            abort(400, message="status is invalid")

        notes = _clean_text(args.get("notes"), field="notes", max_len=2000, allow_newlines=True)
        if notes == "":
            notes = None

        t = Tool(
            owner_id=me.id,
            group_id=args.get("group_id"),
            name=name,
            brand=brand,
            model=model,
            location=location,
            status=status,
            notes=notes,
            created_at=now_iso_utc(),
            updated_at=now_iso_utc(),
        )
        db.session.add(t)
        db.session.commit()
        return {"ok": True, "id": t.id}, 201

class ToolItem(Resource):
    @marshal_with(tool_fields)
    def get(self, tool_id: int):
        me = require_user()
        t = Tool.query.get(tool_id)
        if t is None:
            abort(404, message="tool not found")
        if t.owner_id != me.id:
            abort(403, message="not allowed")
        return t, 200

    def patch(self, tool_id: int):
        me = require_user()
        t = Tool.query.get(tool_id)
        if t is None:
            abort(404, message="tool not found")
        if t.owner_id != me.id:
            abort(403, message="not allowed")

        args = tool_update_parser.parse_args()

        if args.get("name") is not None:
            t.name = validate_short_text(args.get("name"), field="name", required=True, max_len=120)

        if args.get("brand") is not None:
            t.brand = validate_short_text(args.get("brand"), field="brand", required=False, max_len=120)

        if args.get("model") is not None:
            t.model = validate_short_text(args.get("model"), field="model", required=False, max_len=120)

        if args.get("location") is not None:
            t.location = validate_short_text(args.get("location"), field="location", required=False, max_len=120)

        if args.get("notes") is not None:
            notes = _clean_text(args.get("notes"), field="notes", max_len=2000, allow_newlines=True)
            t.notes = notes if notes else None

        if args.get("status") is not None:
            status = _clean_text(args.get("status"), field="status", max_len=40, allow_newlines=False) or "available"
            if status not in TOOL_STATUSES:
                abort(400, message="status is invalid")
            t.status = status

        if "group_id" in args:
            # group_id may be explicitly set to null
            t.group_id = args.get("group_id")

        t.updated_at = now_iso_utc()
        db.session.commit()
        return {"ok": True}, 200

    def delete(self, tool_id: int):
        me = require_user()
        t = Tool.query.get(tool_id)
        if t is None:
            abort(404, message="tool not found")
        if t.owner_id != me.id:
            abort(403, message="not allowed")

        # Remove tool photo links
        for tp in ToolPhoto.query.filter_by(owner_id=me.id, tool_id=t.id).all():
            db.session.delete(tp)

        db.session.delete(t)
        db.session.commit()
        return {"ok": True}, 200

class ToolPhotos(Resource):
    @marshal_with(tool_photo_fields)
    def get(self, tool_id: int):
        me = require_user()
        t = Tool.query.get(tool_id)
        if t is None:
            abort(404, message="tool not found")
        if t.owner_id != me.id:
            abort(403, message="not allowed")

        return (
            ToolPhoto.query.filter_by(owner_id=me.id, tool_id=t.id)
            .order_by(ToolPhoto.id.desc())
            .all(),
            200,
        )

    def post(self, tool_id: int):
        me = require_user()
        t = Tool.query.get(tool_id)
        if t is None:
            abort(404, message="tool not found")
        if t.owner_id != me.id:
            abort(403, message="not allowed")

        args = tool_photo_attach_parser.parse_args()

        p = Photo.query.get(args["photo_id"])
        if p is None:
            abort(404, message="photo not found")
        if p.owner_id != me.id:
            abort(403, message="photo not allowed")

        is_primary = bool(args.get("is_primary") or False)

        if is_primary:
            # Clear existing primary
            for tp in ToolPhoto.query.filter_by(owner_id=me.id, tool_id=t.id, is_primary=True).all():
                tp.is_primary = False

        tp = ToolPhoto(
            owner_id=me.id,
            tool_id=t.id,
            photo_id=p.id,
            is_primary=is_primary,
            created_at=now_iso_utc(),
        )
        db.session.add(tp)
        db.session.commit()

        # bump tool updated_at
        t.updated_at = now_iso_utc()
        db.session.commit()

        return {"ok": True, "id": tp.id}, 201

class ToolPhotoDelete(Resource):
    def delete(self, tool_id: int, tool_photo_id: int):
        me = require_user()
        t = Tool.query.get(tool_id)
        if t is None:
            abort(404, message="tool not found")
        if t.owner_id != me.id:
            abort(403, message="not allowed")

        tp = ToolPhoto.query.get(tool_photo_id)
        if tp is None or tp.tool_id != t.id or tp.owner_id != me.id:
            abort(404, message="tool photo not found")

        db.session.delete(tp)
        t.updated_at = now_iso_utc()
        db.session.commit()
        return {"ok": True}, 200

class ToolPhotoSetPrimary(Resource):
    def post(self, tool_id: int, tool_photo_id: int):
        me = require_user()
        t = Tool.query.get(tool_id)
        if t is None:
            abort(404, message="tool not found")
        if t.owner_id != me.id:
            abort(403, message="not allowed")

        tp = ToolPhoto.query.get(tool_photo_id)
        if tp is None or tp.tool_id != t.id or tp.owner_id != me.id:
            abort(404, message="tool photo not found")

        # Clear existing primary
        for x in ToolPhoto.query.filter_by(owner_id=me.id, tool_id=t.id, is_primary=True).all():
            x.is_primary = False

        tp.is_primary = True
        t.updated_at = now_iso_utc()
        db.session.commit()
        return {"ok": True}, 200

# -----------------------------
# Routes
# -----------------------------
api.add_resource(Health, "/api/health")
api.add_resource(Users, "/api/users")
api.add_resource(AuthRegister, "/api/auth/register")
api.add_resource(AuthLogin, "/api/auth/login")
api.add_resource(AuthMe, "/api/auth/me")

api.add_resource(ApiKeys, "/api/api-keys")
api.add_resource(ApiKeyRevoke, "/api/api-keys/<int:key_id>")

api.add_resource(Messages, "/api/messages")

api.add_resource(Photos, "/api/photos")
api.add_resource(PhotoUpload, "/api/photos/upload")
api.add_resource(PhotoDelete, "/api/photos/<int:photo_id>")
api.add_resource(PhotoToken, "/api/photos/<int:photo_id>/token")
api.add_resource(PhotoView, "/api/photos/<int:photo_id>/view")
api.add_resource(PhotoDownload, "/api/photos/<int:photo_id>/download")

api.add_resource(Timers, "/api/timers")
api.add_resource(TimerItem, "/api/timers/<int:timer_id>")

api.add_resource(ToolGroups, "/api/tool-groups", "/api/tool-groups/")
api.add_resource(ToolGroupDelete, "/api/tool-groups/<int:group_id>")
api.add_resource(Tools, "/api/tools", "/api/tools/")
api.add_resource(ToolItem, "/api/tools/<int:tool_id>")
api.add_resource(ToolPhotos, "/api/tools/<int:tool_id>/photos")
api.add_resource(ToolPhotoDelete, "/api/tools/<int:tool_id>/photos/<int:tool_photo_id>")
api.add_resource(ToolPhotoSetPrimary, "/api/tools/<int:tool_id>/photos/<int:tool_photo_id>/primary")

if __name__ == "__main__":
    app.run(debug=True)