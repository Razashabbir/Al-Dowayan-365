"""Bookmarks: every user saves pages (with the company selected at that moment) and finds them on Home."""
import re

from fastapi import HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import text

import security

MAX = 40


class BookmarkIn(BaseModel):
    path: str = Field(min_length=2, max_length=100)
    title: str = Field(min_length=1, max_length=120)
    tenant_key: int | None = None
    company: str | None = Field(None, max_length=10)


def register(app, engine):
    def me():
        return security.current_user()["user_id"]

    @app.get("/api/auth/bookmarks")
    def list_bookmarks():
        with engine().connect() as cn:
            return [dict(r) for r in cn.execute(text("""SELECT bookmark_id, path, title, tenant_key, company, created_at
                                                       FROM sec.bookmark WHERE user_id = :u ORDER BY bookmark_id"""), {"u": me()}).mappings()]

    @app.post("/api/auth/bookmarks")
    def add_bookmark(body: BookmarkIn):
        if not re.fullmatch(r"/[a-z0-9\-/]+", body.path):
            raise HTTPException(400, "Not a page of this app.")
        u = me()
        with engine().begin() as cn:
            n = cn.execute(text("SELECT COUNT(*) FROM sec.bookmark WHERE user_id = :u"), {"u": u}).scalar()
            if n >= MAX:
                raise HTTPException(400, f"You can keep up to {MAX} bookmarks - remove one first.")
            same = cn.execute(text("""SELECT bookmark_id FROM sec.bookmark WHERE user_id = :u AND path = :p
                                      AND ISNULL(company, '') = ISNULL(:c, '')"""), {"u": u, "p": body.path, "c": body.company}).scalar()
            if same:
                return {"ok": True, "bookmark_id": same}
            bid = cn.execute(text("""INSERT INTO sec.bookmark (user_id, path, title, tenant_key, company)
                                     OUTPUT inserted.bookmark_id VALUES (:u, :p, :t, :k, :c)"""),
                             {"u": u, "p": body.path, "t": body.title.strip(), "k": body.tenant_key, "c": body.company}).scalar()
        return {"ok": True, "bookmark_id": bid}

    @app.delete("/api/auth/bookmarks/{bookmark_id}")
    def delete_bookmark(bookmark_id: int):
        with engine().begin() as cn:
            if not cn.execute(text("DELETE FROM sec.bookmark WHERE bookmark_id = :b AND user_id = :u"), {"b": bookmark_id, "u": me()}).rowcount:
                raise HTTPException(404, "Bookmark not found.")
        return {"ok": True}
