# Límites de integración

React depende de servicios de dominio e interfaces de repositorio, nunca de Supabase. Adaptadores futuros implementarán persistencia, transacciones y mapeo de filas.

Zakaeus será un adaptador asíncrono mediante `IntegrationJob`. Cada trabajo incluye clave de idempotencia, hash del payload, agregado, estado, intentos y próximo reintento. Una venta local se identifica por su clave estable; una respuesta repetida actualiza el mismo trabajo y nunca crea otra venta.

No se conectó ningún servicio en esta fase. Los adaptadores mock actuales permiten sustituir infraestructura sin cambiar la UI.

