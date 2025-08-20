<?php
if(isset($_FILES['file'])) {
    $uploadDir = "uploads/";
    if(!is_dir($uploadDir)) mkdir($uploadDir, 0777, true);
    $uploadFile = $uploadDir . basename($_FILES['file']['name']);
    if(move_uploaded_file($_FILES['file']['tmp_name'], $uploadFile)){
        echo "Archivo subido correctamente";
    } else {
        echo "Error al subir archivo";
    }
} else {
    file_put_contents("uploads/imagen_".time().".jpg", file_get_contents("php://input"));
    echo "Imagen guardada con éxito";
}
?>