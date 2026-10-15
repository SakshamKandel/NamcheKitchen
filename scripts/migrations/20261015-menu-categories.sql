CREATE TABLE IF NOT EXISTS namche.menu_categories (
  kind text NOT NULL CHECK (kind IN ('food','drink')),
  name text NOT NULL CHECK (char_length(name) BETWEEN 2 AND 80 AND name=btrim(name)),
  PRIMARY KEY (kind,name)
);
CREATE UNIQUE INDEX IF NOT EXISTS menu_categories_kind_name_lower_idx ON namche.menu_categories(kind,lower(name));
INSERT INTO namche.menu_categories(kind,name)
SELECT kind,min(category) FROM namche.menu_items
WHERE char_length(category) BETWEEN 2 AND 80 AND category=btrim(category)
GROUP BY kind,lower(category)
ON CONFLICT DO NOTHING;
