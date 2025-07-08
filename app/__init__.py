from flask import Flask
from .config import Config
from .extensions import db, migrate
from .routes import bp as main_bp

def create_app():
    app = Flask(__name__)
    app.config.from_object(Config)

    # initialize extensions
    db.init_app(app)
    migrate.init_app(app, db)

    # register blueprints
    app.register_blueprint(main_bp)

    return app
