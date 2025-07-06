const API_URL = 'api.php'; // Nuestro archivo PHP de backend
const IVA_RATE = 0.19;    // 19% de IVA en Chile
const IVA_FACTOR = 1 + IVA_RATE; // Factor para desglosar (1.19)

let currentChart; // Para almacenar la instancia del gráfico

document.addEventListener('DOMContentLoaded', () => {
    // Establecer la fecha actual en los filtros por defecto
    const today = new Date();
    const firstDayOfMonth = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().split('T')[0];
    const lastDayOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).toISOString().split('T')[0];

    document.getElementById('filterCajaInicio').value = firstDayOfMonth;
    document.getElementById('filterCajaFin').value = lastDayOfMonth;
    document.getElementById('filterVentasInicio').value = firstDayOfMonth;
    document.getElementById('filterVentasFin').value = lastDayOfMonth;
    document.getElementById('filterComprasInicio').value = firstDayOfMonth;
    document.getElementById('filterComprasFin').value = lastDayOfMonth;

    loadProducts(); // Cargar productos al inicio
    showSection('dashboard'); // Mostrar dashboard por defecto
    loadDashboardData(); // Cargar datos del dashboard

    // --- Event Listeners para formularios ---
    document.getElementById('formMovimientoCaja').addEventListener('submit', registrarMovimientoCaja);
    document.getElementById('formVenta').addEventListener('submit', registrarVenta);
    document.getElementById('formCompra').addEventListener('submit', registrarCompra);

    // --- Lógica de cálculo en formularios de VENTA ---
    const ventaProductoSelect = document.getElementById('ventaProducto');
    const ventaCantidadInput = document.getElementById('ventaCantidad');
    const ventaPrecioUnitarioConIVAInput = document.getElementById('ventaPrecioUnitarioConIVA'); // Precio Unitario (IVA Inc.)
    const ventaMontoNetoInput = document.getElementById('ventaMontoNeto');
    const ventaIVAInput = document.getElementById('ventaIVA');
    const ventaMontoTotalInput = document.getElementById('ventaMontoTotal');

    if (ventaProductoSelect) {
        ventaProductoSelect.addEventListener('change', () => {
            const selectedProductOption = ventaProductoSelect.options[ventaProductoSelect.selectedIndex];
            // 'precio_venta_con_iva' se carga desde el backend y ya tiene el IVA incluido
            if (selectedProductOption && selectedProductOption.dataset.precioConIva) {
                ventaPrecioUnitarioConIVAInput.value = parseFloat(selectedProductOption.dataset.precioConIva).toFixed(2);
                calcularTotalesVenta();
            }
        });
    }
    if (ventaCantidadInput) {
        ventaCantidadInput.addEventListener('input', calcularTotalesVenta);
    }
    // No hay listener directo en ventaMontoTotalInput porque es readonly

    // --- Lógica de cálculo en formularios de COMPRA ---
    const compraTipoSelect = document.getElementById('compraTipo');
    const compraProductoFieldsDiv = document.getElementById('compraProductoFields');
    const compraProductoSelect = document.getElementById('compraProducto');
    const compraCantidadInput = document.getElementById('compraCantidad');
    const compraConceptoInput = document.getElementById('compraConcepto');
    const compraMontoTotalInput = document.getElementById('compraMontoTotal'); // Este es el campo donde el usuario ingresa el TOTAL
    const compraMontoNetoInput = document.getElementById('compraMontoNeto');
    const compraIVAInput = document.getElementById('compraIVA');


    if (compraTipoSelect) {
        compraTipoSelect.addEventListener('change', () => {
            if (compraTipoSelect.value === 'stock') {
                compraProductoFieldsDiv.style.display = 'block';
                compraProductoSelect.setAttribute('required', 'required');
                compraCantidadInput.setAttribute('required', 'required');
                // Disparar cambio en producto para cargar costo si hay uno seleccionado
                compraProductoSelect.dispatchEvent(new Event('change'));
            } else {
                compraProductoFieldsDiv.style.display = 'none';
                compraProductoSelect.removeAttribute('required');
                compraCantidadInput.removeAttribute('required');
                // Limpiar campos de stock y concepto al cambiar a gasto general
                compraProductoSelect.value = '';
                compraCantidadInput.value = '1';
                compraConceptoInput.value = '';
            }
            // Resetear montos al cambiar tipo para evitar cálculos incorrectos
            compraMontoTotalInput.value = '';
            compraMontoNetoInput.value = '';
            compraIVAInput.value = '';
        });
        // Disparar en la carga inicial para ocultar/mostrar si es necesario
        compraTipoSelect.dispatchEvent(new Event('change'));
    }

    if (compraProductoSelect) {
         compraProductoSelect.addEventListener('change', () => {
            const selectedProductOption = compraProductoSelect.options[compraProductoSelect.selectedIndex];
            // 'costo_unitario_con_iva' se carga desde el backend y ya tiene el IVA incluido
            if (selectedProductOption && selectedProductOption.dataset.costoConIva) {
                 // Si es compra de stock, el monto total se pre-calcula
                 const unitCostWithIVA = parseFloat(selectedProductOption.dataset.costoConIva);
                 const quantity = parseInt(compraCantidadInput.value || 1);
                 compraMontoTotalInput.value = (unitCostWithIVA * quantity).toFixed(2);
                 compraConceptoInput.value = `Compra de ${quantity} x ${selectedProductOption.textContent}`;
                 calcularTotalesCompra();
            } else {
                // Si no hay producto seleccionado o no tiene costo, limpiar
                compraMontoTotalInput.value = '';
                calcularTotalesCompra();
            }
        });
    }
    if (compraCantidadInput) {
        compraCantidadInput.addEventListener('input', () => {
            // Re-calcular el monto total si la cantidad cambia en compra de stock
            if (compraTipoSelect.value === 'stock') {
                const selectedProductOption = compraProductoSelect.options[compraProductoSelect.selectedIndex];
                if (selectedProductOption && selectedProductOption.dataset.costoConIva) {
                    const unitCostWithIVA = parseFloat(selectedProductOption.dataset.costoConIva);
                    const quantity = parseInt(compraCantidadInput.value || 1);
                    compraMontoTotalInput.value = (unitCostWithIVA * quantity).toFixed(2);
                    compraConceptoInput.value = `Compra de ${quantity} x ${selectedProductOption.textContent}`;
                }
            }
            calcularTotalesCompra(); // Recalcular desglose
        });
    }
    if (compraMontoTotalInput) { // El usuario ingresa aquí el monto total con IVA
        compraMontoTotalInput.addEventListener('input', calcularTotalesCompra);
    }
});


/**
 * Calcula y muestra el desglose de neto e IVA para el formulario de Venta.
 * Los cálculos son solo para la interfaz de usuario.
 */
function calcularTotalesVenta() {
    const cantidad = parseInt(document.getElementById('ventaCantidad').value);
    const precioUnitarioConIVA = parseFloat(document.getElementById('ventaPrecioUnitarioConIVA').value);

    if (isNaN(cantidad) || isNaN(precioUnitarioConIVA) || cantidad <= 0 || precioUnitarioConIVA <= 0) {
        document.getElementById('ventaMontoNeto').value = '';
        document.getElementById('ventaIVA').value = '';
        document.getElementById('ventaMontoTotal').value = '';
        return;
    }

    const montoTotal = cantidad * precioUnitarioConIVA;
    const montoNeto = montoTotal / IVA_FACTOR;
    const iva = montoTotal - montoNeto;

    document.getElementById('ventaMontoNeto').value = montoNeto.toFixed(2);
    document.getElementById('ventaIVA').value = iva.toFixed(2);
    document.getElementById('ventaMontoTotal').value = montoTotal.toFixed(2); // Mostrar el total con IVA
}

/**
 * Calcula y muestra el desglose de neto e IVA para el formulario de Compra/Gasto.
 * El usuario ingresa el monto total con IVA.
 */
function calcularTotalesCompra() {
    const montoTotalConIVA = parseFloat(document.getElementById('compraMontoTotal').value);

    if (isNaN(montoTotalConIVA) || montoTotalConIVA <= 0) {
        document.getElementById('compraMontoNeto').value = '';
        document.getElementById('compraIVA').value = '';
        return;
    }

    const montoNeto = montoTotalConIVA / IVA_FACTOR;
    const iva = montoTotalConIVA - montoNeto;

    document.getElementById('compraMontoNeto').value = montoNeto.toFixed(2);
    document.getElementById('compraIVA').value = iva.toFixed(2);
}

/**
 * Muestra un mensaje en la interfaz de usuario.
 * @param {string} elementId ID del elemento HTML donde se mostrará el mensaje.
 * @param {string} msg El mensaje a mostrar.
 * @param {boolean} isError Indica si el mensaje es de error (true) o éxito (false).
 */
function showMessage(elementId, msg, isError = false) {
    const element = document.getElementById(elementId);
    if (!element) {
        console.error(`Elemento con ID '${elementId}' no encontrado para mostrar mensaje.`);
        return;
    }
    element.textContent = msg;
    element.classList.remove('error', 'show'); // Limpiar clases anteriores
    if (isError) {
        element.classList.add('error');
    }
    element.classList.add('show');
    setTimeout(() => {
        element.classList.remove('show');
    }, 5000); // El mensaje desaparece después de 5 segundos
}

/**
 * Muestra la sección de la aplicación solicitada y carga sus datos.
 * @param {string} sectionId ID de la sección a mostrar.
 */
function showSection(sectionId) {
    document.querySelectorAll('section').forEach(section => {
        section.classList.remove('active');
    });
    document.getElementById(sectionId).classList.add('active');

    // Cargar datos específicos al mostrar la sección
    if (sectionId === 'libroCaja') {
        loadLibroCaja();
    } else if (sectionId === 'rcvVentas') {
        loadRcvVentas();
    } else if (sectionId === 'rcvCompras') {
        loadRcvCompras();
    } else if (sectionId === 'dashboard') {
        loadDashboardData();
    }
}

/**
 * Carga los productos desde el backend y los llena en los select de venta y compra.
 * También almacena el precio/costo con IVA en los dataset para cálculos frontend.
 */
async function loadProducts() {
    try {
        const response = await fetch(`${API_URL}?action=get_products`);
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        const products = await response.json();

        const ventaProductSelect = document.getElementById('ventaProducto');
        const compraProductSelect = document.getElementById('compraProducto');

        // Limpiar opciones existentes y añadir opción por defecto
        ventaProductSelect.innerHTML = '<option value="">Seleccione un producto</option>';
        compraProductSelect.innerHTML = '<option value="">Seleccione un producto</option>';

        products.forEach(product => {
            // Opciones para el formulario de Venta
            const optionVenta = document.createElement('option');
            optionVenta.value = product.id;
            optionVenta.textContent = product.nombre;
            // Almacenar el precio de venta CON IVA en el dataset
            optionVenta.dataset.precioConIva = product.precio_venta_con_iva;
            optionVenta.dataset.stock = product.stock; // También el stock para validación
            ventaProductSelect.appendChild(optionVenta);

            // Opciones para el formulario de Compra (solo para compra de stock)
            const optionCompra = document.createElement('option');
            optionCompra.value = product.id;
            optionCompra.textContent = product.nombre;
            // Almacenar el costo unitario CON IVA en el dataset
            optionCompra.dataset.costoConIva = product.costo_unitario_con_iva;
            compraProductSelect.appendChild(optionCompra);
        });

        // Preseleccionar el primer producto si existe y disparar evento change para calcular
        if (products.length > 0) {
            ventaProductSelect.value = products[0].id;
            ventaProductSelect.dispatchEvent(new Event('change'));
            compraProductSelect.value = products[0].id;
            compraProductoSelect.dispatchEvent(new Event('change'));
        }

    } catch (error) {
        console.error('Error al cargar productos:', error);
        showMessage('ventaMsg', 'Error al cargar productos.', true);
        showMessage('compraMsg', 'Error al cargar productos.', true);
    }
}

/**
 * Maneja el envío del formulario para registrar un movimiento de caja.
 */
async function registrarMovimientoCaja(event) {
    event.preventDefault();
    const data = {
        action: 'add_movimiento_caja',
        tipo: document.getElementById('movimientoTipo').value,
        concepto: document.getElementById('movimientoConcepto').value,
        monto_total: parseFloat(document.getElementById('movimientoMonto').value),
        medio_pago: document.getElementById('movimientoMedioPago').value,
        afecta_impuestos: document.getElementById('movimientoAfectaImpuestos').checked ? 1 : 0,
        doc_tributario_asociado: document.getElementById('movimientoDocTributario').value
    };

    try {
        const response = await fetch(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        const result = await response.json();
        if (result.success) {
            showMessage('movimientoCajaMsg', 'Movimiento de caja registrado con éxito.');
            document.getElementById('formMovimientoCaja').reset();
            loadDashboardData(); // Actualizar dashboard después de un cambio
        } else {
            showMessage('movimientoCajaMsg', `Error: ${result.message}`, true);
        }
    } catch (error) {
        console.error('Error al registrar movimiento de caja:', error);
        showMessage('movimientoCajaMsg', 'Error al conectar con el servidor.', true);
    }
}

/**
 * Maneja el envío del formulario para registrar una venta.
 */
async function registrarVenta(event) {
    event.preventDefault();
    const productoId = document.getElementById('ventaProducto').value;
    const cantidad = parseInt(document.getElementById('ventaCantidad').value);
    const precioUnitarioConIVA = parseFloat(document.getElementById('ventaPrecioUnitarioConIVA').value);
    const montoTotalConIva = parseFloat(document.getElementById('ventaMontoTotal').value); // Monto total, IVA incluido

    // Validar stock antes de enviar
    const stockElement = document.querySelector(`#ventaProducto option[value="${productoId}"]`);
    const currentStock = parseInt(stockElement.dataset.stock || '0');
    if (cantidad > currentStock) {
        showMessage('ventaMsg', `Stock insuficiente. Disponible: ${currentStock}.`, true);
        return;
    }

    const data = {
        action: 'add_venta',
        producto_id: productoId,
        cantidad: cantidad,
        precio_unitario_con_iva: precioUnitarioConIVA, // Se envía el precio unitario CON IVA
        monto_total_con_iva: montoTotalConIva,       // Se envía el monto total CON IVA
        metodo_pago: document.getElementById('ventaMetodoPago').value,
        n_documento: document.getElementById('ventaNumDoc').value
    };

    try {
        const response = await fetch(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        const result = await response.json();
        if (result.success) {
            showMessage('ventaMsg', 'Venta registrada con éxito.', false);
            document.getElementById('formVenta').reset();
            loadProducts(); // Recargar productos para actualizar stock y precios
            loadDashboardData(); // Actualizar dashboard
        } else {
            showMessage('ventaMsg', `Error: ${result.message}`, true);
        }
    } catch (error) {
        console.error('Error al registrar venta:', error);
        showMessage('ventaMsg', 'Error al conectar con el servidor.', true);
    }
}

/**
 * Maneja el envío del formulario para registrar una compra o gasto.
 */
async function registrarCompra(event) {
    event.preventDefault();
    const compraTipo = document.getElementById('compraTipo').value;
    let productoId = null;
    let cantidad = null;
    let concepto = document.getElementById('compraConcepto').value;

    if (compraTipo === 'stock') {
        productoId = document.getElementById('compraProducto').value;
        cantidad = parseInt(document.getElementById('compraCantidad').value);
        const productSelect = document.getElementById('compraProducto');
        const selectedProduct = productSelect.options[productSelect.selectedIndex];
        concepto = `Compra de ${cantidad} x ${selectedProduct.textContent}`; // Ajustar concepto para stock
    }

    // El monto total con IVA es el que el usuario ingresó
    const montoTotalConIva = parseFloat(document.getElementById('compraMontoTotal').value);

    const data = {
        action: 'add_compra',
        producto_id: productoId,
        cantidad: cantidad,
        concepto: concepto,
        monto_total_con_iva: montoTotalConIva, // Se envía el monto total CON IVA
        n_documento: document.getElementById('compraNumDoc').value
    };

    try {
        const response = await fetch(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        const result = await response.json();
        if (result.success) {
            showMessage('compraMsg', 'Compra/Gasto registrado con éxito.', false);
            document.getElementById('formCompra').reset();
            // Restablecer el tipo de compra a 'stock' y mostrar campos de producto
            document.getElementById('compraTipo').value = 'stock';
            document.getElementById('compraProductoFields').style.display = 'block';
            loadProducts(); // Recargar productos para actualizar stock
            loadDashboardData(); // Actualizar dashboard
        } else {
            showMessage('compraMsg', `Error: ${result.message}`, true);
        }
    } catch (error) {
        console.error('Error al registrar compra/gasto:', error);
        showMessage('compraMsg', 'Error al conectar con el servidor.', true);
    }
}

/**
 * Carga y muestra los datos del Libro de Caja en la tabla.
 */
async function loadLibroCaja() {
    const tableBody = document.querySelector('#tablaLibroCaja tbody');
    tableBody.innerHTML = ''; // Limpiar tabla antes de cargar nuevos datos
    const startDate = document.getElementById('filterCajaInicio').value;
    const endDate = document.getElementById('filterCajaFin').value;

    try {
        // Primero, obtener el saldo inicial acumulado hasta el día anterior al filtro
        const saldoInicialResponse = await fetch(`${API_URL}?action=get_libro_caja_saldo_inicial&date_before=${startDate}`);
        if (!saldoInicialResponse.ok) throw new Error(`HTTP error! status: ${saldoInicialResponse.status}`);
        const saldoInicialData = await saldoInicialResponse.json();
        let saldoAcumulado = parseFloat(saldoInicialData.saldo_inicial) || 0;

        // Luego, obtener los movimientos dentro del rango de filtro
        const movimientosResponse = await fetch(`${API_URL}?action=get_libro_caja&start_date=${startDate}&end_date=${endDate}`);
        if (!movimientosResponse.ok) throw new Error(`HTTP error! status: ${movimientosResponse.status}`);
        const movimientos = await movimientosResponse.json();

        movimientos.forEach(mov => {
            const row = tableBody.insertRow();
            // Calcular el saldo acumulado para cada fila
            saldoAcumulado += (mov.tipo === 'ingreso' ? parseFloat(mov.monto_total) : -parseFloat(mov.monto_total));

            row.insertCell().textContent = new Date(mov.fecha).toLocaleString('es-CL');
            row.insertCell().textContent = mov.tipo.charAt(0).toUpperCase() + mov.tipo.slice(1); // Capitalizar
            row.insertCell().textContent = mov.concepto;
            row.insertCell().textContent = `$${parseFloat(mov.monto_total).toLocaleString('es-CL')}`;
            row.insertCell().textContent = mov.medio_pago;
            row.insertCell().textContent = mov.afecta_impuestos == 1 ? 'Sí' : 'No';
            row.insertCell().textContent = mov.doc_tributario_asociado || '-';
            row.insertCell().textContent = `$${saldoAcumulado.toLocaleString('es-CL')}`;
        });
    } catch (error) {
        console.error('Error al cargar libro de caja:', error);
        showMessage('libroCaja', 'Error al cargar datos del Libro de Caja.', true);
    }
}

/**
 * Carga y muestra los datos del RCV de Ventas.
 */
async function loadRcvVentas() {
    const tableBody = document.querySelector('#tablaRcvVentas tbody');
    tableBody.innerHTML = '';
    const startDate = document.getElementById('filterVentasInicio').value;
    const endDate = document.getElementById('filterVentasFin').value;

    try {
        const response = await fetch(`${API_URL}?action=get_rcv_ventas&start_date=${startDate}&end_date=${endDate}`);
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        const ventas = await response.json();

        let totalNeto = 0;
        let totalIVA = 0;

        ventas.forEach(venta => {
            const row = tableBody.insertRow();
            row.insertCell().textContent = new Date(venta.fecha).toLocaleString('es-CL');
            row.insertCell().textContent = venta.nombre_producto || 'N/A';
            row.insertCell().textContent = venta.cantidad;
            // Calcular precio unitario con IVA para mostrar, desde el neto almacenado
            const precioUnitarioConIVA = parseFloat(venta.precio_unitario_neto) * IVA_FACTOR;
            row.insertCell().textContent = `$${precioUnitarioConIVA.toLocaleString('es-CL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
            row.insertCell().textContent = `$${parseFloat(venta.monto_neto_total).toLocaleString('es-CL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
            row.insertCell().textContent = `$${parseFloat(venta.monto_iva).toLocaleString('es-CL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
            row.insertCell().textContent = `$${parseFloat(venta.monto_total_con_iva).toLocaleString('es-CL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
            row.insertCell().textContent = venta.metodo_pago;
            row.insertCell().textContent = venta.n_documento;

            totalNeto += parseFloat(venta.monto_neto_total);
            totalIVA += parseFloat(venta.monto_iva);
        });
        document.getElementById('totalNetoVentas').textContent = `$${totalNeto.toLocaleString('es-CL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
        document.getElementById('totalIVADebito').textContent = `$${totalIVA.toLocaleString('es-CL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

    } catch (error) {
        console.error('Error al cargar RCV Ventas:', error);
        showMessage('rcvVentas', 'Error al cargar datos del RCV Ventas.', true);
    }
}

/**
 * Carga y muestra los datos del RCV de Compras y Gastos.
 */
async function loadRcvCompras() {
    const tableBody = document.querySelector('#tablaRcvCompras tbody');
    tableBody.innerHTML = '';
    const startDate = document.getElementById('filterComprasInicio').value;
    const endDate = document.getElementById('filterComprasFin').value;

    try {
        const response = await fetch(`${API_URL}?action=get_rcv_compras&start_date=${startDate}&end_date=${endDate}`);
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        const compras = await response.json();

        let totalNeto = 0;
        let totalIVA = 0;

        compras.forEach(compra => {
            const row = tableBody.insertRow();
            row.insertCell().textContent = new Date(compra.fecha).toLocaleString('es-CL');
            row.insertCell().textContent = compra.concepto;
            row.insertCell().textContent = compra.nombre_producto || '-';
            row.insertCell().textContent = compra.cantidad || '-';
            row.insertCell().textContent = `$${parseFloat(compra.monto_total_con_iva).toLocaleString('es-CL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
            row.insertCell().textContent = `$${parseFloat(compra.monto_neto).toLocaleString('es-CL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
            row.insertCell().textContent = `$${parseFloat(compra.monto_iva).toLocaleString('es-CL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
            row.insertCell().textContent = compra.n_documento;

            totalNeto += parseFloat(compra.monto_neto);
            totalIVA += parseFloat(compra.monto_iva);
        });
        document.getElementById('totalNetoCompras').textContent = `$${totalNeto.toLocaleString('es-CL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
        document.getElementById('totalIVACredito').textContent = `$${totalIVA.toLocaleString('es-CL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

    } catch (error) {
        console.error('Error al cargar RCV Compras:', error);
        showMessage('rcvCompras', 'Error al cargar datos del RCV Compras.', true);
    }
}

/**
 * Carga los datos del dashboard (saldo de caja, ventas del mes, stock).
 */
async function loadDashboardData() {
    try {
        const saldoResponse = await fetch(`${API_URL}?action=get_saldo_caja`);
        if (!saldoResponse.ok) throw new Error(`HTTP error! status: ${saldoResponse.status}`);
        const saldoData = await saldoResponse.json();
        document.getElementById('saldoCaja').textContent = `$${parseFloat(saldoData.saldo).toLocaleString('es-CL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

        const ventasMesResponse = await fetch(`${API_URL}?action=get_total_ventas_mes`);
        if (!ventasMesResponse.ok) throw new Error(`HTTP error! status: ${ventasMesResponse.status}`);
        const ventasMesData = await ventasMesResponse.json();
        // El total de ventas del mes se muestra neto en el dashboard
        document.getElementById('totalVentasMes').textContent = `$${parseFloat(ventasMesData.total_ventas_netas).toLocaleString('es-CL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

        const stockResponse = await fetch(`${API_URL}?action=get_products`);
        if (!stockResponse.ok) throw new Error(`HTTP error! status: ${stockResponse.status}`);
        const products = await stockResponse.json();
        const chaquetasStock = products.find(p => p.nombre === 'Chaqueta')?.stock || 0;
        const polerasStock = products.find(p => p.nombre === 'Polera')?.stock || 0;
        document.getElementById('stockChaquetas').textContent = chaquetasStock.toLocaleString('es-CL');
        document.getElementById('stockPoleras').textContent = polerasStock.toLocaleString('es-CL');

        // Chart data
        const chartDataResponse = await fetch(`${API_URL}?action=get_monthly_cash_flow`);
        if (!chartDataResponse.ok) throw new Error(`HTTP error! status: ${chartDataResponse.status}`);
        const chartData = await chartDataResponse.json();
        renderCashFlowChart(chartData);

    } catch (error) {
        console.error('Error al cargar datos del dashboard:', error);
        // showMessage('dashboard', 'Error al cargar datos del dashboard.', true); // No mostrar error persistente en dashboard
    }
}

/**
 * Renderiza el gráfico de flujo de caja mensual.
 * @param {Array<Object>} data Datos de ingresos y egresos mensuales.
 */
function renderCashFlowChart(data) {
    const ctx = document.getElementById('cashFlowChart').getContext('2d');
    // Ordenar los datos por fecha para que el gráfico sea cronológico
    data.sort((a, b) => new Date(`${a.anio}-${a.mes}-01`) - new Date(`${b.anio}-${b.mes}-01`));

    const labels = data.map(d => `${d.mes}/${d.anio}`);
    const ingresos = data.map(d => parseFloat(d.ingresos));
    const egresos = data.map(d => parseFloat(d.egresos));

    if (currentChart) {
        currentChart.destroy(); // Destruir gráfico anterior para evitar duplicados
    }

    currentChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [
                {
                    label: 'Ingresos Totales',
                    data: ingresos,
                    backgroundColor: 'rgba(75, 192, 192, 0.6)',
                    borderColor: 'rgba(75, 192, 192, 1)',
                    borderWidth: 1
                },
                {
                    label: 'Egresos Totales',
                    data: egresos,
                    backgroundColor: 'rgba(255, 99, 132, 0.6)',
                    borderColor: 'rgba(255, 99, 132, 1)',
                    borderWidth: 1
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                x: {
                    beginAtZero: true,
                    title: {
                        display: true,
                        text: 'Mes'
                    }
                },
                y: {
                    beginAtZero: true,
                    title: {
                        display: true,
                        text: 'Monto ($)'
                    },
                     ticks: {
                        callback: function(value) {
                            return '$' + value.toLocaleString('es-CL'); // Formato moneda chilena
                        }
                    }
                }
            },
            plugins: {
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            let label = context.dataset.label || '';
                            if (label) {
                                label += ': ';
                            }
                            if (context.parsed.y !== null) {
                                label += '$' + context.parsed.y.toLocaleString('es-CL');
                            }
                            return label;
                        }
                    }
                }
            }
        }
    });
}

/**
 * Exporta el contenido de una tabla HTML a un archivo CSV.
 * @param {string} tableId ID de la tabla a exportar.
 * @param {string} filename Nombre del archivo CSV.
 */
function exportTableToCSV(tableId, filename) {
    const table = document.getElementById(tableId);
    if (!table) {
        console.error(`Tabla con ID '${tableId}' no encontrada.`);
        return;
    }
    let csv = [];
    // Obtener encabezados
    let headers = [];
    table.querySelectorAll('thead th').forEach(th => headers.push(`"${th.innerText.replace(/"/g, '""')}"`)); // Escapar comillas dobles
    csv.push(headers.join(';')); // Unir con punto y coma para CSV

    // Obtener filas de datos
    table.querySelectorAll('tbody tr').forEach(row => {
        let rowData = [];
        row.querySelectorAll('td').forEach(cell => {
            let cellText = cell.innerText;
            // Limpiar símbolos de moneda y puntos de miles, reemplazar coma decimal por punto
            cellText = cellText.replace('$', '').replace(/\./g, '');
            // Asegurarse de que el separador decimal sea un punto para consistencia en CSV numérico
            if (cellText.includes(',')) {
                cellText = cellText.replace(',', '.');
            }
            rowData.push(`"${cellText.replace(/"/g, '""')}"`); // Escapar comillas dobles
        });
        csv.push(rowData.join(';'));
    });

    const csvFile = new Blob([csv.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const downloadLink = document.createElement('a');
    downloadLink.download = filename;
    downloadLink.href = window.URL.createObjectURL(csvFile);
    downloadLink.style.display = 'none';
    document.body.appendChild(downloadLink);
    downloadLink.click();
    document.body.removeChild(downloadLink);
}