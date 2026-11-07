package server

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestNewHandler(t *testing.T) {
	handler := NewHandler()

	tests := []struct {
		name           string
		method         string
		target         string
		expectedStatus int
		validateJSON   bool
	}{
		{
			name:           "GET /healthz 200",
			method:         http.MethodGet,
			target:         "/healthz",
			expectedStatus: http.StatusOK,
		},
		{
			name:           "GET /readyz 200",
			method:         http.MethodGet,
			target:         "/readyz",
			expectedStatus: http.StatusOK,
		},
		{
			name:           "GET / 200 with JSON",
			method:         http.MethodGet,
			target:         "/",
			expectedStatus: http.StatusOK,
			validateJSON:   true,
		},
		{
			name:           "GET /nope 404",
			method:         http.MethodGet,
			target:         "/nope",
			expectedStatus: http.StatusNotFound,
		},
		{
			name:           "POST /healthz 405",
			method:         http.MethodPost,
			target:         "/healthz",
			expectedStatus: http.StatusMethodNotAllowed,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest(tt.method, tt.target, nil)
			rr := httptest.NewRecorder()

			handler.ServeHTTP(rr, req)

			if rr.Code != tt.expectedStatus {
				t.Errorf("expected status %d, got %d", tt.expectedStatus, rr.Code)
			}

			if tt.validateJSON {
				contentType := rr.Header().Get("Content-Type")
				if contentType != "application/json" {
					t.Errorf("expected Content-Type application/json, got %q", contentType)
				}

				var body map[string]string
				if err := json.NewDecoder(rr.Body).Decode(&body); err != nil {
					t.Fatalf("failed to decode JSON response: %v", err)
				}

				if body["service"] != "${{ values.name }}" {
					t.Errorf("expected service field to be '${{ values.name }}', got %q", body["service"])
				}
			}
		})
	}
}
