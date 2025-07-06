<?php
// Establece el encabezado para indicar que la respuesta será JSON
header('Content-Type: application/json');

// --- Configuración de la base de datos ---
define('DB_SERVER', 'localhost'); // Usualmente 'localhost' para XAMPP
define('DB_USERNAME', 'root');   // Usuario por defecto de XAMPP
define('DB_PASSWORD', '');       // Contraseña por defecto de XAMPP
define('DB_NAME', 'fashionflow_pyme'); // Nombre de la base de datos que creaste

// --- Conectar a la base de datos ---
$mysqli = new mysqli(DB_SERVER, DB_USERNAME, DB_PASSWORD, DB_NAME);

// Verificar la conexión
if ($mysqli->connect_error) {
    die(json_encode(['success' => false, 'message' => 'Error de conexión a la base de datos: ' . $mysqli->connect_error]));
}

// Establecer el juego de caracteres a UTF-8 para evitar problemas con tildes y caracteres especiales
$mysqli->set_charset("utf8mb4");

// --- Constantes para el IVA ---
const IVA_RATE = 0.19;      // Tasa de IVA en Chile (19%)
const IVA_FACTOR = 1 + IVA_RATE; // Factor para calcular el neto a partir del total con IVA (1.19)

// Determinar la acción solicitada
$action = $_GET['action'] ?? $_POST['action'] ?? '';

// Si la solicitud es POST, decodificar el cuerpo JSON (esperado para añadir datos)
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $input = json_decode(file_get_contents('php://input'), true);
    $action = $input['action'] ?? ''; // La acción también puede venir en el cuerpo JSON
}

// --- Enrutador de acciones ---
switch ($action) {
    // Acciones POST (para añadir/modificar datos)
    case 'add_movimiento_caja':
        addMovimientoCaja($mysqli, $input);
        break;
    case 'add_venta':
        addVenta($mysqli, $input);
        break;
    case 'add_compra':
        addCompra($mysqli, $input);
        break;

    // Acciones GET (para obtener datos)
    case 'get_products':
        getProducts($mysqli);
        break;
    case 'get_libro_caja':
        getLibroCaja($mysqli, $_GET['start_date'] ?? null, $_GET['end_date'] ?? null);
        break;
    case 'get_libro_caja_saldo_inicial':
        getLibroCajaSaldoInicial($mysqli, $_GET['date_before'] ?? null);
        break;
    case 'get_rcv_ventas':
        getRcvVentas($mysqli, $_GET['start_date'] ?? null, $_GET['end_date'] ?? null);
        break;
    case 'get_rcv_compras':
        getRcvCompras($mysqli, $_GET['start_date'] ?? null, $_GET['end_date'] ?? null);
        break;
    case 'get_saldo_caja':
        getSaldoCaja($mysqli);
        break;
    case 'get_total_ventas_mes':
        getTotalVentasMes($mysqli);
        break;
    case 'get_monthly_cash_flow':
        getMonthlyCashFlow($mysqli);
        break;

    default:
        // Manejar casos de acción no válida o método no permitido
        echo json_encode(['success' => false, 'message' => 'Acción no válida o método de solicitud no permitido.']);
        break;
}

// Cierra la conexión a la base de datos al finalizar
$mysqli->close();

// --- Funciones de Backend ---

/**
 * Añade un movimiento de caja al libro.
 * Asume que el monto ya es el monto total a registrar.
 */
function addMovimientoCaja($mysqli, $data) {
    $fecha = date('Y-m-d H:i:s');
    $tipo = $mysqli->real_escape_string($data['tipo']);
    $concepto = $mysqli->real_escape_string($data['concepto']);
    $monto_total = floatval($data['monto_total']); // Monto total tal cual se ingresa
    $medio_pago = $mysqli->real_escape_string($data['medio_pago']);
    $afecta_impuestos = intval($data['afecta_impuestos']); // Si es una factura exenta, por ejemplo

    $sql = "INSERT INTO movimientos_caja (fecha, tipo, concepto, monto_total, medio_pago, afecta_impuestos, doc_tributario_asociado)
            VALUES (?, ?, ?, ?, ?, ?, ?)";
    $stmt = $mysqli->prepare($sql);
    $stmt->bind_param("sssdiss", $fecha, $tipo, $concepto, $monto_total, $medio_pago, $afecta_impuestos, $data['doc_tributario_asociado']);

    if ($stmt->execute()) {
        echo json_encode(['success' => true, 'message' => 'Movimiento de caja registrado con éxito.']);
    } else {
        echo json_encode(['success' => false, 'message' => 'Error al registrar movimiento de caja: ' . $stmt->error]);
    }
    $stmt->close();
}

/**
 * Registra una venta, actualiza stock y registra en libro de caja.
 * Recibe el monto_total_con_iva y lo desglosa.
 */
function addVenta($mysqli, $data) {
    $mysqli->begin_transaction(); // Inicia una transacción para asegurar la atomicidad de las operaciones
    try {
        $fecha = date('Y-m-d H:i:s');
        $producto_id = intval($data['producto_id']);
        $cantidad = intval($data['cantidad']);
        $precio_unitario_con_iva = floatval($data['precio_unitario_con_iva']); // Precio unitario con IVA (desde el frontend)
        $monto_total_con_iva = floatval($data['monto_total_con_iva']);         // Monto total con IVA (desde el frontend)

        // *** Desglose del IVA en el backend ***
        $monto_neto_total = $monto_total_con_iva / IVA_FACTOR;
        $monto_iva = $monto_total_con_iva - $monto_neto_total;
        $precio_unitario_neto = $precio_unitario_con_iva / IVA_FACTOR;

        $metodo_pago = $mysqli->real_escape_string($data['metodo_pago']);
        $n_documento = $mysqli->real_escape_string($data['n_documento']);

        // 1. Verificar y actualizar stock
        // Usamos FOR UPDATE para bloquear la fila durante la transacción y evitar condiciones de carrera
        $stmt_stock = $mysqli->prepare("SELECT stock FROM productos WHERE id = ? FOR UPDATE");
        $stmt_stock->bind_param("i", $producto_id);
        $stmt_stock->execute();
        $result_stock = $stmt_stock->get_result();
        $current_stock = $result_stock->fetch_assoc()['stock'];
        $stmt_stock->close();

        if ($cantidad > $current_stock) {
            $mysqli->rollback(); // Revertir todos los cambios si no hay stock
            echo json_encode(['success' => false, 'message' => 'Stock insuficiente para el producto.']);
            return;
        }

        // 2. Insertar en tabla de ventas (valores desglosados)
        $sql_venta = "INSERT INTO ventas (fecha, producto_id, cantidad, precio_unitario_neto, monto_neto_total, monto_iva, monto_total_con_iva, metodo_pago, n_documento)
                      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)";
        $stmt_venta = $mysqli->prepare($sql_venta);
        $stmt_venta->bind_param("siiddddds", $fecha, $producto_id, $cantidad, $precio_unitario_neto, $monto_neto_total, $monto_iva, $monto_total_con_iva, $metodo_pago, $n_documento);
        $stmt_venta->execute();
        $stmt_venta->close();

        // 3. Registrar el ingreso en movimientos_caja (monto total con IVA)
        $concepto_caja = "Venta de productos (Doc: " . $n_documento . ")";
        $sql_caja = "INSERT INTO movimientos_caja (fecha, tipo, concepto, monto_total, medio_pago, afecta_impuestos, doc_tributario_asociado)
                     VALUES (?, 'ingreso', ?, ?, ?, 1, ?)"; // Afecta impuestos = 1 para RCV
        $stmt_caja = $mysqli->prepare($sql_caja);
        $stmt_caja->bind_param("ssdss", $fecha, $concepto_caja, $monto_total_con_iva, $metodo_pago, $n_documento);
        $stmt_caja->execute();
        $stmt_caja->close();

        // 4. Actualizar stock del producto
        $sql_update_stock = "UPDATE productos SET stock = stock - ? WHERE id = ?";
        $stmt_update_stock = $mysqli->prepare($sql_update_stock);
        $stmt_update_stock->bind_param("ii", $cantidad, $producto_id);
        $stmt_update_stock->execute();
        $stmt_update_stock->close();

        $mysqli->commit(); // Confirma todos los cambios si todo fue exitoso
        echo json_encode(['success' => true, 'message' => 'Venta registrada con éxito.']);
    } catch (mysqli_sql_exception $exception) {
        $mysqli->rollback(); // Revertir todos los cambios si algo falla
        echo json_encode(['success' => false, 'message' => 'Error al registrar venta: ' . $exception->getMessage()]);
    }
}

/**
 * Registra una compra o gasto, actualiza stock (si aplica) y registra en libro de caja.
 * Recibe el monto_total_con_iva y lo desglosa.
 */
function addCompra($mysqli, $data) {
    $mysqli->begin_transaction();
    try {
        $fecha = date('Y-m-d H:i:s');
        $producto_id = $data['producto_id'] ? intval($data['producto_id']) : null;
        $cantidad = $data['cantidad'] ? intval($data['cantidad']) : null;
        $concepto = $mysqli->real_escape_string($data['concepto']);
        $n_documento = $mysqli->real_escape_string($data['n_documento']);

        // El monto_total_con_iva es el que se ingresa por el usuario
        $monto_total_con_iva = floatval($data['monto_total_con_iva']);

        // *** Desglose del IVA en el backend ***
        $monto_neto = $monto_total_con_iva / IVA_FACTOR;
        $monto_iva = $monto_total_con_iva - $monto_neto;

        // 1. Insertar en tabla de compras (valores desglosados)
        $sql_compra = "INSERT INTO compras (fecha, producto_id, cantidad, concepto, monto_neto, monto_iva, monto_total_con_iva, n_documento)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?)";
        $stmt_compra = $mysqli->prepare($sql_compra);
        // Usa "siiisddd" para vincular los tipos de datos: string, int, int, string, decimal, decimal, decimal, string
        $stmt_compra->bind_param("siisddds", $fecha, $producto_id, $cantidad, $concepto, $monto_neto, $monto_iva, $monto_total_con_iva, $n_documento);
        $stmt_compra->execute();
        $stmt_compra->close();

        // 2. Registrar el egreso en movimientos_caja (monto total con IVA)
        $concepto_caja = "Compra/Gasto (Doc: " . $n_documento . "): " . $concepto;
        // Se asume "Transferencia Bancaria" para compras, podría ser otro campo si se desea
        $sql_caja = "INSERT INTO movimientos_caja (fecha, tipo, concepto, monto_total, medio_pago, afecta_impuestos, doc_tributario_asociado)
                     VALUES (?, 'egreso', ?, ?, 'Transferencia Bancaria', 1, ?)"; // Afecta impuestos = 1 para RCV
        $stmt_caja = $mysqli->prepare($sql_caja);
        $stmt_caja->bind_param("ssdss", $fecha, $concepto_caja, $monto_total_con_iva, $n_documento);
        $stmt_caja->execute();
        $stmt_caja->close();

        // 3. Si es una compra de stock, actualizar el stock del producto
        if ($producto_id && $cantidad) {
            $sql_update_stock = "UPDATE productos SET stock = stock + ? WHERE id = ?";
            $stmt_update_stock = $mysqli->prepare($sql_update_stock);
            $stmt_update_stock->bind_param("ii", $cantidad, $producto_id);
            $stmt_update_stock->execute();
            $stmt_update_stock->close();
        }

        $mysqli->commit();
        echo json_encode(['success' => true, 'message' => 'Compra/Gasto registrado con éxito.']);
    } catch (mysqli_sql_exception $exception) {
        $mysqli->rollback();
        echo json_encode(['success' => false, 'message' => 'Error al registrar compra/gasto: ' . $exception->getMessage()]);
    }
}

/**
 * Obtiene la lista de productos con sus costos y precios de venta (CON IVA)
 * para cargar en los select del frontend.
 */
function getProducts($mysqli) {
    // Calculamos el costo/precio con IVA a partir del neto almacenado en DB
    $sql = "SELECT id, nombre,
                   costo_unitario_neto * " . IVA_FACTOR . " AS costo_unitario_con_iva,
                   precio_venta_neto * " . IVA_FACTOR . " AS precio_venta_con_iva,
                   stock
            FROM productos ORDER BY nombre";
    $result = $mysqli->query($sql);
    $products = [];
    while ($row = $result->fetch_assoc()) {
        $products[] = $row;
    }
    echo json_encode($products);
}

/**
 * Obtiene los movimientos del libro de caja para un rango de fechas.
 */
function getLibroCaja($mysqli, $startDate, $endDate) {
    $sql = "SELECT id, fecha, tipo, concepto, monto_total, medio_pago, afecta_impuestos, doc_tributario_asociado FROM movimientos_caja";
    $params = [];
    $types = "";

    $where_clauses = [];
    if ($startDate) {
        $where_clauses[] = "fecha >= ?";
        $params[] = $startDate . " 00:00:00";
        $types .= "s";
    }
    if ($endDate) {
        $where_clauses[] = "fecha <= ?";
        $params[] = $endDate . " 23:59:59";
        $types .= "s";
    }

    if (!empty($where_clauses)) {
        $sql .= " WHERE " . implode(" AND ", $where_clauses);
    }
    $sql .= " ORDER BY fecha ASC";

    $stmt = $mysqli->prepare($sql);
    if ($params) {
        $stmt->bind_param($types, ...$params);
    }
    $stmt->execute();
    $result = $stmt->get_result();
    $movimientos = [];
    while ($row = $result->fetch_assoc()) {
        $movimientos[] = $row;
    }
    $stmt->close();
    echo json_encode($movimientos);
}

/**
 * Calcula el saldo acumulado de caja antes de una fecha específica.
 * Usado para inicializar el saldo en el Libro de Caja.
 */
function getLibroCajaSaldoInicial($mysqli, $dateBefore) {
    $saldo = 0.0;
    if ($dateBefore) {
        $sql = "SELECT SUM(CASE WHEN tipo = 'ingreso' THEN monto_total ELSE -monto_total END) as saldo_inicial
                FROM movimientos_caja
                WHERE fecha < ?";
        $stmt = $mysqli->prepare($sql);
        $dateBeforeFull = $dateBefore . " 00:00:00"; // Incluye hasta el día anterior
        $stmt->bind_param("s", $dateBeforeFull);
        $stmt->execute();
        $result = $stmt->get_result();
        $row = $result->fetch_assoc();
        $saldo = $row['saldo_inicial'] ?? 0.0;
        $stmt->close();
    }
    echo json_encode(['saldo_inicial' => $saldo]);
}

/**
 * Obtiene el registro de ventas para el RCV (Registro de Compras y Ventas).
 * Muestra los montos con el desglose.
 */
function getRcvVentas($mysqli, $startDate, $endDate) {
    // Las columnas ya están desglosadas en la DB
    $sql = "SELECT v.*, p.nombre AS nombre_producto
            FROM ventas v
            LEFT JOIN productos p ON v.producto_id = p.id";
    $params = [];
    $types = "";

    $where_clauses = [];
    if ($startDate) {
        $where_clauses[] = "v.fecha >= ?";
        $params[] = $startDate . " 00:00:00";
        $types .= "s";
    }
    if ($endDate) {
        $where_clauses[] = "v.fecha <= ?";
        $params[] = $endDate . " 23:59:59";
        $types .= "s";
    }

    if (!empty($where_clauses)) {
        $sql .= " WHERE " . implode(" AND ", $where_clauses);
    }
    $sql .= " ORDER BY v.fecha ASC";

    $stmt = $mysqli->prepare($sql);
    if ($params) {
        $stmt->bind_param($types, ...$params);
    }
    $stmt->execute();
    $result = $stmt->get_result();
    $ventas = [];
    while ($row = $result->fetch_assoc()) {
        $ventas[] = $row;
    }
    $stmt->close();
    echo json_encode($ventas);
}

/**
 * Obtiene el registro de compras y gastos para el RCV.
 * Muestra los montos con el desglose.
 */
function getRcvCompras($mysqli, $startDate, $endDate) {
    // Las columnas ya están desglosadas en la DB
    $sql = "SELECT c.*, p.nombre AS nombre_producto FROM compras c
            LEFT JOIN productos p ON c.producto_id = p.id";
    $params = [];
    $types = "";

    $where_clauses = [];
    if ($startDate) {
        $where_clauses[] = "c.fecha >= ?";
        $params[] = $startDate . " 00:00:00";
        $types .= "s";
    }
    if ($endDate) {
        $where_clauses[] = "c.fecha <= ?";
        $params[] = $endDate . " 23:59:59";
        $types .= "s";
    }

    if (!empty($where_clauses)) {
        $sql .= " WHERE " . implode(" AND ", $where_clauses);
    }
    $sql .= " ORDER BY c.fecha ASC";

    $stmt = $mysqli->prepare($sql);
    if ($params) {
        $stmt->bind_param($types, ...$params);
    }
    $stmt->execute();
    $result = $stmt->get_result();
    $compras = [];
    while ($row = $result->fetch_assoc()) {
        $compras[] = $row;
    }
    $stmt->close();
    echo json_encode($compras);
}

/**
 * Obtiene el saldo actual de la caja.
 */
function getSaldoCaja($mysqli) {
    $sql = "SELECT SUM(CASE WHEN tipo = 'ingreso' THEN monto_total ELSE -monto_total END) as saldo FROM movimientos_caja";
    $result = $mysqli->query($sql);
    $row = $result->fetch_assoc();
    echo json_encode(['saldo' => $row['saldo'] ?? 0]);
}

/**
 * Obtiene el total de ventas netas del mes actual para el dashboard.
 */
function getTotalVentasMes($mysqli) {
    $current_month = date('Y-m-01 00:00:00');
    $next_month = date('Y-m-01 00:00:00', strtotime('+1 month'));
    $sql = "SELECT SUM(monto_neto_total) as total_ventas_netas FROM ventas WHERE fecha >= ? AND fecha < ?";
    $stmt = $mysqli->prepare($sql);
    $stmt->bind_param("ss", $current_month, $next_month);
    $stmt->execute();
    $result = $stmt->get_result();
    $row = $result->fetch_assoc();
    echo json_encode(['total_ventas_netas' => $row['total_ventas_netas'] ?? 0]);
    $stmt->close();
}

/**
 * Obtiene el flujo de caja mensual (ingresos y egresos) para el gráfico del dashboard.
 */
function getMonthlyCashFlow($mysqli) {
    $data = [];
    // Recorre los últimos 6 meses (incluyendo el actual)
    for ($i = 5; $i >= 0; $i--) {
        $month = date('m', strtotime("-$i month"));
        $year = date('Y', strtotime("-$i month"));
        $start_date = date('Y-m-01 00:00:00', strtotime("-$i month"));
        $end_date = date('Y-m-t 23:59:59', strtotime("-$i month"));

        $sql = "SELECT SUM(CASE WHEN tipo = 'ingreso' THEN monto_total ELSE 0 END) as ingresos,
                       SUM(CASE WHEN tipo = 'egreso' THEN monto_total ELSE 0 END) as egresos
                FROM movimientos_caja
                WHERE fecha BETWEEN ? AND ?";
        $stmt = $mysqli->prepare($sql);
        $stmt->bind_param("ss", $start_date, $end_date);
        $stmt->execute();
        $result = $stmt->get_result();
        $row = $result->fetch_assoc();

        $data[] = [
            'anio' => $year,
            'mes' => $month,
            'ingresos' => $row['ingresos'] ?? 0,
            'egresos' => $row['egresos'] ?? 0
        ];
        $stmt->close();
    }
    echo json_encode($data);
}
?>