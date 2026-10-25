CREATE TABLE rate_limits (
  scope TEXT NOT NULL,
  bucket_key TEXT NOT NULL,
  window_start INTEGER NOT NULL,
  request_count INTEGER NOT NULL CHECK (request_count >= 0),
  PRIMARY KEY (scope, bucket_key)
);

CREATE INDEX rate_limits_window_idx ON rate_limits(window_start);