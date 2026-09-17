// Mín. 8 caracteres, com maiúscula, minúscula, número e um caractere
// que não seja letra/número (pontuação, símbolo — "." "," ";" "!" etc
// contam). Mesma regra replicada em js/ui.js pro frontend validar sem
// round-trip; esta cópia é quem de fato garante a regra, já que o
// cliente sempre pode ser contornado.
const PASSWORD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9\s]).{8,}$/;

function isPasswordStrong(password) {
  return typeof password === 'string' && PASSWORD_REGEX.test(password);
}

module.exports = { isPasswordStrong };
