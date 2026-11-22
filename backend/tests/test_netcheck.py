# SPDX-License-Identifier: EUPL-1.2
import ipaddress

import pytest

from wledstudio import netcheck


def r(*ips):
    return lambda host: [ipaddress.ip_address(i) for i in ips]


@pytest.mark.parametrize("value", ["wled.lan", "192.168.1.5", "wled-desk.local:8080", "[fe80::1]", "10.0.0.2:80"])
def test_accepts_names_and_addresses(value):
    assert netcheck.check_device_host(value, resolver=r("192.168.1.5"))


@pytest.mark.parametrize("value", ["http://wled.lan", "wled.lan/path", "user@wled.lan", "wled.lan:99999",
                                   "wled lan", "", "-bad.lan", "wled.lan:80:80", "a" * 300])
def test_rejects_anything_else(value):
    with pytest.raises(netcheck.HostError):
        netcheck.check_device_host(value, resolver=r("192.168.1.5"))


def test_public_addresses_refused_by_default():
    with pytest.raises(netcheck.HostError, match="public"):
        netcheck.check_device_host("example.com", resolver=r("93.184.216.34"))
    assert netcheck.check_device_host("example.com", allow_public=True, resolver=r("93.184.216.34"))


def test_any_public_address_in_the_answer_is_refused():
    with pytest.raises(netcheck.HostError):
        netcheck.check_device_host("mixed.lan", resolver=r("192.168.1.5", "8.8.8.8"))


def test_loopback_and_link_local_allowed():
    assert netcheck.check_device_host("localhost", resolver=r("127.0.0.1"))
    assert netcheck.check_device_host("x.lan", resolver=r("169.254.1.2"))


def test_unresolvable():
    with pytest.raises(netcheck.HostError):
        netcheck.check_device_host("nope.invalid", resolver=lambda h: [])


def test_real_resolver_with_ip_literal():
    assert netcheck.resolve("127.0.0.1") == [ipaddress.ip_address("127.0.0.1")]
