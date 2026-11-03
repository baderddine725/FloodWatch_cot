# =============================================================================
#  Module    : Cloud of Things – FloodWatch (Sup'Com 2026-2027)
#  Couche    : simulateur – tests
#  Fichier   : simulator/tests/test_config.py
#  Équipe    : FloodWatch – Auteur : Ksontini Amine
#  Créé le   : 2026-11-03          Modifié le : 2026-11-03          Version : 1.0
# =============================================================================
"""Configuration centralisée : priorités CLI > environnement > défauts, validation au démarrage."""
import pytest

from fwsim.config import ConfigError, PER_STATION_USER, load_config


def test_defaults_use_gateway_registry():
    cfg = load_config([], env={})
    assert [s.code for s in cfg.stations] == ["underpass-01", "wadi-01"]
    assert cfg.stations[1].type == "WADI" and cfg.stations[1].zone == "ariana"
    assert (cfg.stations[0].lat, cfg.stations[0].lon) == (36.8625, 10.1956)  # = SeedManager du middleware


def test_environment_then_cli_priority():
    env = {"SIM_HOST": "mosquitto-local", "SIM_PORT": "1884", "SIM_SPEED": "3", "SIM_RAW": "true",
           "SIM_USERNAME": PER_STATION_USER, "SIM_PASSWORD": "secret"}
    cfg = load_config(["--port", "1883"], env=env)
    assert (cfg.host, cfg.port, cfg.speed, cfg.raw) == ("mosquitto-local", 1883, 3.0, True)
    assert cfg.username_for("wadi-01") == "wadi-01"
    assert "secret" not in repr(cfg)  # le secret n'apparaît jamais dans les journaux


def test_unknown_station_gets_generic_identity():
    cfg = load_config(["--stations", "ford-09"], env={})
    assert cfg.stations[0].type == "OTHER" and cfg.stations[0].zone == "ariana"


@pytest.mark.parametrize("argv, env, problem", [
    (["--port", "70000"], {}, "port"),
    (["--speed", "0"], {}, "speed"),
    (["--scenario", "tsunami"], {}, "scenario"),
    (["--username", "gateway"], {}, "password"),
    (["--stations", "Bad_Code"], {}, "code invalide"),
    (["--stations", "wadi-01,wadi-01"], {}, "double"),
    (["--td-broker-url", "http://x"], {}, "td_broker_url"),
    (["--tls", "--cafile", "absent.crt"], {}, "cafile"),
    ([], {"SIM_PORT": "abc"}, "variable d'environnement"),
])
def test_invalid_configuration_lists_problems(argv, env, problem):
    with pytest.raises(ConfigError) as exc:
        load_config(argv, env=env)
    assert any(problem in p for p in exc.value.problems), exc.value.problems


def test_all_problems_reported_at_once():
    with pytest.raises(ConfigError) as exc:
        load_config(["--port", "0", "--speed", "-1", "--scenario", "x"], env={})
    assert len(exc.value.problems) == 3
