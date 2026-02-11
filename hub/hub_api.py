import os
from datetime import datetime, timezone

from flask import Flask, request, send_from_directory
from flask_sqlalchemy import SQLAlchemy
from flask_restful import Api, Resource, reqparse, fields, marshal_with, abort
from flask_cors import CORS
from werkzeug.utils import secure_filename

# -----------------------------
# App setup
# -----------------------------
app = Flask(__name__)
CORS(app)

# Optional: make browser preflights always succeed
@app.before_request
def _handle_preflight():
    if request.method == "OPTIONS":
        return "", 204

# Put the SQLite DB inside ./instance/
os.makedirs(app.instance_path, exist_ok=True)
db_path = os.path.join(app.instance_path, "database_noauth.db")
app.config["SQLALCHEMY_DATABASE_URI"] = f"sqlite:///{db_path}"
app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False

# Folder for uploaded photos
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
STORAGE_DIR = os.path.join(BASE_DIR, "storage")
os.makedirs(STORAGE_DIR, exist_ok=True)

db = SQLAlchemy(app)
api = Api(app)

# -----------------------------
# Helpers
# -----------------------------
def now_iso_utc() -> str:
    return datetime.now(timezone.utc).isoformat()

# -----------------------------
# Models
# -----------------------------
class User(db.Model):
    __tablename__ = "users"
    id = db.Column(db.Integer, primary_key=True)

    username = db.Column(db.String(80), unique=True, nullable=False)
    created_at = db.Column(db.String(32), nullable=False)

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
    original_name = db.Column(db.String(255), nullable=False)
    stored_name = db.Column(db.String(255), unique=True, nullable=False)
    size_bytes = db.Column(db.Integer, nullable=False)
    created_at = db.Column(db.String(32), nullable=False)

class Timer(db.Model):
    __tablename__ = "timers"
    id = db.Column(db.Integer, primary_key=True)

    owner_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False)
    label = db.Column(db.String(120), nullable=False)
    start_utc = db.Column(db.String(32), nullable=False)
    duration_seconds = db.Column(db.Integer, nullable=False)

with app.app_context():
    db.create_all()

# -----------------------------
# Parsers
# -----------------------------
user_parser = reqparse.RequestParser()
user_parser.add_argument("username", type=str, required=True, help="username is required")

message_parser = reqparse.RequestParser()
message_parser.add_argument("sender_id", type=int, required=True, help="sender_id is required")
message_parser.add_argument("recipient_id", type=int, required=True, help="recipient_id is required")
message_parser.add_argument("body", type=str, required=True, help="body is required")

timer_parser = reqparse.RequestParser()
timer_parser.add_argument("owner_id", type=int, required=True, help="owner_id is required")
timer_parser.add_argument("label", type=str, required=True, help="label is required")
timer_parser.add_argument("duration_seconds", type=int, required=True, help="duration_seconds is required")

# -----------------------------
# Marshal fields (JSON)
# -----------------------------
user_fields = {"id": fields.Integer, "username": fields.String, "created_at": fields.String}

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
    "original_name": fields.String,
    "stored_name": fields.String,
    "size_bytes": fields.Integer,
    "created_at": fields.String,
}

timer_fields = {
    "id": fields.Integer,
    "owner_id": fields.Integer,
    "label": fields.String,
    "start_utc": fields.String,
    "duration_seconds": fields.Integer,
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
        return User.query.order_by(User.id).all(), 200

    @marshal_with(user_fields)
    def post(self):
        args = user_parser.parse_args()
        username = args["username"].strip()

        if not username:
            abort(400, message="username cannot be empty")

        if User.query.filter_by(username=username).first() is not None:
            abort(409, message="username already exists")

        u = User(username=username, created_at=now_iso_utc())
        db.session.add(u)
        db.session.commit()
        return u, 201

class Messages(Resource):
    @marshal_with(message_fields)
    def get(self):
        user_id = request.args.get("user_id", type=int)
        sender_id = request.args.get("sender_id", type=int)
        recipient_id = request.args.get("recipient_id", type=int)

        q = Message.query

        if user_id is not None:
            q = q.filter((Message.sender_id == user_id) | (Message.recipient_id == user_id))

        if sender_id is not None:
            q = q.filter(Message.sender_id == sender_id)

        if recipient_id is not None:
            q = q.filter(Message.recipient_id == recipient_id)

        return q.order_by(Message.id.desc()).limit(200).all(), 200

    @marshal_with(message_fields)
    def post(self):
        args = message_parser.parse_args()

        if User.query.get(args["sender_id"]) is None:
            abort(400, message="sender_id does not exist")
        if User.query.get(args["recipient_id"]) is None:
            abort(400, message="recipient_id does not exist")

        body = args["body"].strip()
        if not body:
            abort(400, message="body cannot be empty")

        m = Message(
            sender_id=args["sender_id"],
            recipient_id=args["recipient_id"],
            body=body,
            created_at=now_iso_utc(),
        )
        db.session.add(m)
        db.session.commit()
        return m, 201

class Photos(Resource):
    @marshal_with(photo_fields)
    def get(self):
        owner_id = request.args.get("owner_id", type=int)
        q = Photo.query
        if owner_id is not None:
            q = q.filter_by(owner_id=owner_id)
        return q.order_by(Photo.id.desc()).all(), 200

class PhotoUpload(Resource):
    @marshal_with(photo_fields)
    def post(self):
        owner_id = request.form.get("owner_id", type=int)
        if owner_id is None:
            abort(400, message="owner_id is required (form field)")

        if User.query.get(owner_id) is None:
            abort(400, message="owner_id does not exist")

        if "file" not in request.files:
            abort(400, message="file is required")

        f = request.files["file"]
        if f.filename is None or f.filename.strip() == "":
            abort(400, message="file must have a filename")

        original_name = f.filename
        safe_original = secure_filename(original_name) or "upload"

        stored_name = f"{owner_id}_{int(datetime.now().timestamp())}_{safe_original}"
        stored_path = os.path.join(STORAGE_DIR, stored_name)

        f.save(stored_path)
        size_bytes = os.path.getsize(stored_path)

        p = Photo(
            owner_id=owner_id,
            original_name=original_name,
            stored_name=stored_name,
            size_bytes=size_bytes,
            created_at=now_iso_utc(),
        )
        db.session.add(p)
        db.session.commit()
        return p, 201

class PhotoDownload(Resource):
    def get(self, photo_id: int):
        p = Photo.query.get(photo_id)
        if p is None:
            abort(404, message="photo not found")
        return send_from_directory(STORAGE_DIR, p.stored_name, as_attachment=True)

class Timers(Resource):
    @marshal_with(timer_fields)
    def get(self):
        owner_id = request.args.get("owner_id", type=int)
        q = Timer.query
        if owner_id is not None:
            q = q.filter_by(owner_id=owner_id)
        return q.order_by(Timer.id.desc()).all(), 200

    @marshal_with(timer_fields)
    def post(self):
        args = timer_parser.parse_args()

        if User.query.get(args["owner_id"]) is None:
            abort(400, message="owner_id does not exist")

        if args["duration_seconds"] <= 0:
            abort(400, message="duration_seconds must be > 0")

        t = Timer(
            owner_id=args["owner_id"],
            label=args["label"].strip() or "Timer",
            start_utc=now_iso_utc(),
            duration_seconds=args["duration_seconds"],
        )
        db.session.add(t)
        db.session.commit()
        return t, 201

class TimerStatus(Resource):
    def get(self, timer_id: int):
        t = Timer.query.get(timer_id)
        if t is None:
            abort(404, message="timer not found")

        start = datetime.fromisoformat(t.start_utc)
        now = datetime.now(timezone.utc)
        elapsed = int((now - start).total_seconds())
        remaining = max(0, t.duration_seconds - elapsed)
        done = remaining == 0

        return {
            "id": t.id,
            "label": t.label,
            "start_utc": t.start_utc,
            "duration_seconds": t.duration_seconds,
            "elapsed_seconds": elapsed,
            "remaining_seconds": remaining,
            "done": done,
            "time_utc": now_iso_utc(),
        }, 200

# -----------------------------
# Routes
# -----------------------------
api.add_resource(Health, "/api/health", "/api/health/")
api.add_resource(Users, "/api/users", "/api/users/")
api.add_resource(Messages, "/api/messages", "/api/messages/")
api.add_resource(Photos, "/api/photos", "/api/photos/")
api.add_resource(PhotoUpload, "/api/photos/upload", "/api/photos/upload/")
api.add_resource(PhotoDownload, "/api/photos/<int:photo_id>/download")
api.add_resource(Timers, "/api/timers", "/api/timers/")
api.add_resource(TimerStatus, "/api/timers/<int:timer_id>/status")

@app.route("/")
def home():
    return """
    <h1>Hub API (No Auth)</h1>
    <ul>
      <li><a href="/api/health">/api/health</a></li>
      <li><a href="/api/users">/api/users</a></li>
      <li><a href="/api/messages">/api/messages</a></li>
      <li><a href="/api/photos">/api/photos</a></li>
      <li><a href="/api/timers">/api/timers</a></li>
    </ul>
    """

if __name__ == "__main__":
    app.run(debug=True)
