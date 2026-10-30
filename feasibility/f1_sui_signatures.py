import base64
import hashlib
import json
import secrets
import sys

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey, Ed25519PublicKey
from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat

ED25519_FLAG = 0x00
PERSONAL_MESSAGE_INTENT = bytes([3, 0, 0])
BECH32_CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l"


def uleb128(n):
    out = bytearray()
    while True:
        byte = n & 0x7F
        n >>= 7
        if n:
            out.append(byte | 0x80)
        else:
            out.append(byte)
            return bytes(out)


def blake2b256(data):
    return hashlib.blake2b(data, digest_size=32).digest()


def personal_message_digest(message):
    return blake2b256(PERSONAL_MESSAGE_INTENT + uleb128(len(message)) + message)


def public_key_bytes(public_key):
    return public_key.public_bytes(Encoding.Raw, PublicFormat.Raw)


def sui_address(public_key):
    return "0x" + blake2b256(bytes([ED25519_FLAG]) + public_key_bytes(public_key)).hex()


def sign_personal_message(private_key, message):
    signature = private_key.sign(personal_message_digest(message))
    serialized = bytes([ED25519_FLAG]) + signature + public_key_bytes(private_key.public_key())
    return base64.b64encode(serialized).decode()


def verify_personal_message(message, serialized_signature, expected_address):
    raw = base64.b64decode(serialized_signature)
    if len(raw) != 97:
        return ("INVALID", "BAD_LENGTH")
    if raw[0] != ED25519_FLAG:
        return ("UNSUPPORTED_SIGNATURE", "NOT_ED25519")
    public_key = Ed25519PublicKey.from_public_bytes(raw[65:97])
    if sui_address(public_key) != expected_address:
        return ("INVALID", "SIGNER_MISMATCH")
    try:
        public_key.verify(raw[1:65], personal_message_digest(message))
    except InvalidSignature:
        return ("INVALID", "SIGNATURE_INVALID")
    return ("VALID", None)


def bech32_decode_suiprivkey(text):
    hrp, data = text.rsplit("1", 1)
    values = [BECH32_CHARSET.index(c) for c in data][:-6]
    acc, bits, out = 0, 0, bytearray()
    for v in values:
        acc = (acc << 5) | v
        bits += 5
        while bits >= 8:
            bits -= 8
            out.append((acc >> bits) & 0xFF)
    if hrp != "suiprivkey" or out[0] != ED25519_FLAG:
        raise ValueError("not an ed25519 suiprivkey")
    return bytes(out[1:33])


def change_message(payee_id, old_address, new_address, nonce, expires):
    return "\n".join([
        "Countersign payee change v1",
        f"payee:{payee_id}",
        f"from:{old_address}",
        f"to:{new_address}",
        f"nonce:{nonce}",
        f"expires:{expires}",
    ]).encode()


def run():
    results = []

    def check(name, passed, detail=""):
        results.append({"check": name, "passed": bool(passed), "detail": detail})

    vector_key = Ed25519PrivateKey.from_private_bytes(bytes([
        59, 148, 11, 85, 134, 130, 61, 253, 2, 174, 59, 70, 27, 180, 51, 107, 94, 203, 174, 253, 102,
        39, 170, 146, 46, 252, 4, 143, 236, 12, 136, 28,
    ]))
    vector_message = bytes([0, 0, 0, 5, 72, 101, 108, 108, 111])
    expected = "ADXvYCSZk+ZtVL6VfB4+5zson++q0uWYINW4u1QKbbPisLUnNgYPFieiwXxp2SroKzqrULJOXdkPiDESw+IWJgVa4iC0svZel3wS7eYVef9RcLbCLABhaMN7XnxhrwGAgw=="
    produced = sign_personal_message(vector_key, vector_message)
    check("V1 personal-message signature equals Mysten ts-sdks vector (keypair.test.ts)", produced == expected, produced[:24])

    keytool_vectors = [
        ("suiprivkey1qrwsjvr6gwaxmsvxk4cfun99ra8uwxg3c9pl0nhle7xxpe4s80y05ctazer", "0xa2d14fad60c56049ecf75246a481934691214ce413e6a8ae2fe6834c173a6133"),
        ("suiprivkey1qzdvpa77ct272ultqcy20dkw78dysnfyg90fhcxkdm60el0qht9mvzlsh4j", "0x1ada6e6f3f3e4055096f606c746690f1108fcc2ca479055cc434a3e1d3f758aa"),
        ("suiprivkey1qqqscjyyr64jea849dfv9cukurqj2swx0m3rr4hr7sw955jy07tzgcde5ut", "0xe69e896ca10f5a77732769803cc2b5707f0ab9d4407afb5e4b4464b89769af14"),
    ]
    for i, (privkey, address) in enumerate(keytool_vectors, 1):
        key = Ed25519PrivateKey.from_private_bytes(bech32_decode_suiprivkey(privkey))
        check(f"V2.{i} suiprivkey → address equals Rust keytool vector", sui_address(key.public_key()) == address)

    vector_address = sui_address(vector_key.public_key())
    check("V3 verify accepts the Mysten vector signature for its signer",
          verify_personal_message(vector_message, expected, vector_address) == ("VALID", None))

    old_payee = Ed25519PrivateKey.generate()
    new_payee = Ed25519PrivateKey.generate()
    attacker = Ed25519PrivateKey.generate()
    old_addr = sui_address(old_payee.public_key())
    new_addr = sui_address(new_payee.public_key())
    evil_addr = sui_address(attacker.public_key())
    nonce = secrets.token_hex(16)
    msg = change_message("landlord", old_addr, new_addr, nonce, "2026-10-31T09:00:00Z")

    check("C05a continuity: old payee's signature over the change verifies",
          verify_personal_message(msg, sign_personal_message(old_payee, msg), old_addr) == ("VALID", None))
    attacker_msg = change_message("landlord", old_addr, evil_addr, nonce, "2026-10-31T09:00:00Z")
    check("C06 attacker signing the change with own key fails continuity (SIGNER_MISMATCH)",
          verify_personal_message(attacker_msg, sign_personal_message(attacker, attacker_msg), old_addr)[1] == "SIGNER_MISMATCH")
    check("C06b attacker can prove control of own address (so control alone must never verify)",
          verify_personal_message(attacker_msg, sign_personal_message(attacker, attacker_msg), evil_addr) == ("VALID", None))
    tampered = change_message("landlord", old_addr, evil_addr, nonce, "2026-10-31T09:00:00Z")
    check("C07a old payee's signature does not transfer to a tampered 'to' address",
          verify_personal_message(tampered, sign_personal_message(old_payee, msg), old_addr)[1] == "SIGNATURE_INVALID")
    other_payee = change_message("designer", old_addr, new_addr, nonce, "2026-10-31T09:00:00Z")
    check("C07b signature bound to payee id: reuse for another payee fails",
          verify_personal_message(other_payee, sign_personal_message(old_payee, msg), old_addr)[1] == "SIGNATURE_INVALID")
    later = change_message("landlord", old_addr, new_addr, nonce, "2026-12-31T09:00:00Z")
    check("C07c signature bound to expiry: extending expiry fails",
          verify_personal_message(later, sign_personal_message(old_payee, msg), old_addr)[1] == "SIGNATURE_INVALID")
    check("C07d intent separation: raw ed25519 signature over the message (no intent) is rejected",
          verify_personal_message(msg, base64.b64encode(bytes([0]) + old_payee.sign(msg) + public_key_bytes(old_payee.public_key())).decode(), old_addr)[1] == "SIGNATURE_INVALID")
    check("C07e non-ed25519 flag is UNSUPPORTED, never VALID",
          verify_personal_message(msg, base64.b64encode(bytes([1]) + bytes(96)).decode(), old_addr)[0] == "UNSUPPORTED_SIGNATURE")
    new_control = change_message("landlord", old_addr, new_addr, nonce, "2026-10-31T09:00:00Z")
    check("C05b control: new payee proves control of new address",
          verify_personal_message(new_control, sign_personal_message(new_payee, new_control), new_addr) == ("VALID", None))

    passed = sum(r["passed"] for r in results)
    print(json.dumps({"suite": "F1 sui personal-message signatures (offline)", "passed": passed, "total": len(results), "results": results}, indent=2))
    return passed == len(results)


if __name__ == "__main__":
    sys.exit(0 if run() else 1)
