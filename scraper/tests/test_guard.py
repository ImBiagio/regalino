"""Le regole di rete del browser dello scraper (ADR 0005)."""

import pytest

from guard import Guard, is_public_ip, target_of


@pytest.mark.parametrize(
    "ip",
    ["127.0.0.1", "192.168.1.1", "10.0.0.5", "172.17.0.2", "169.254.169.254", "100.64.0.1",
     "::1", "fd00::1", "::ffff:192.168.1.1", "0.0.0.0", "224.0.0.1"],
)
def test_indirizzi_non_pubblici(ip):
    assert not is_public_ip(ip)


def test_indirizzo_pubblico():
    assert is_public_ip("93.184.215.14")


@pytest.mark.parametrize(
    "url",
    ["ftp://negozio.it/a.png", "file:///etc/passwd", "https://negozio.it:8443/",
     "https://utente:pass@negozio.it/", "chrome://settings", "javascript:alert(1)"],
)
def test_url_non_ammessi(url):
    assert target_of(url) is None
    assert not Guard(resolver=lambda host, port: True).allows(url)


def test_guard_chiede_al_resolver_una_volta_per_nome():
    asked = []

    def resolver(host, port):
        asked.append((host, port))
        return host != "router.casa"

    guard = Guard(resolver=resolver)
    assert guard.allows("https://www.negozio.it/p/1")
    assert guard.allows("https://www.negozio.it/img/2.jpg")
    assert not guard.allows("http://router.casa/admin")
    assert guard.allows("data:image/png;base64,AAAA")
    assert asked == [("www.negozio.it", 443), ("router.casa", 80)]
