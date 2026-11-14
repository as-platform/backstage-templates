import pytest
from fastapi.testclient import TestClient

from app.main import SERVICE, create_app


@pytest.fixture(name="client")
def client_fixture() -> TestClient:
    return TestClient(create_app())


def test_index_names_the_service(client: TestClient) -> None:
    response = client.get("/")
    assert response.status_code == 200
    assert response.json() == {"service": SERVICE}


@pytest.mark.parametrize("path", ["/healthz", "/readyz"])
def test_probes_return_ok(client: TestClient, path: str) -> None:
    assert client.get(path).status_code == 200


def test_unknown_path_is_not_found(client: TestClient) -> None:
    assert client.get("/missing").status_code == 404


def test_wrong_method_is_not_allowed(client: TestClient) -> None:
    assert client.post("/").status_code == 405
